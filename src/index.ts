import ts, { factory } from "typescript";
import dotenv from "dotenv";
import path from "path";
import fs from "fs";
import colors from "colors";
import { assert } from "console";
import { formatTransformerDebug, formatTransformerDiagnostic, formatTransformerWarning } from "./shared";

const enum MacroIdentifier {
	Env = "$env",
	IfEnv = "$ifEnv",
}

let verboseLogging = false;

function visitNodeAndChildren(
	node: ts.SourceFile,
	program: ts.Program,
	context: ts.TransformationContext,
): ts.SourceFile;
function visitNodeAndChildren(
	node: ts.Node,
	program: ts.Program,
	context: ts.TransformationContext,
): ts.Node | undefined;
function visitNodeAndChildren(
	node: ts.Node,
	program: ts.Program,
	context: ts.TransformationContext,
): ts.Node | undefined {
	return ts.visitEachChild(
		visitNode(node, program),
		(childNode) => visitNodeAndChildren(childNode, program, context),
		context,
	);
}

function log(message: string) {
	if (verboseLogging) {
		console.log(formatTransformerDebug(message));
	}
}

function warn(message: string) {
	process.stdout.write(`[rbxts-transform-env] ${colors.yellow(message)}\n`);
}

const jsNumber = /^(\d+|0x[0-9A-Fa-f]+|[^_][0-9_]+[^_])$/;

function isNumberUnionType(type: ts.TypeNode) {
	return (
		ts.isUnionTypeNode(type) && type.types.every((v) => ts.isLiteralTypeNode(v) && ts.isNumericLiteral(v.literal))
	);
}

function isStringUnionType(type: ts.TypeNode) {
	return (
		ts.isUnionTypeNode(type) && type.types.every((v) => ts.isLiteralTypeNode(v) && ts.isStringLiteral(v.literal))
	);
}

function transformLiteral(program: ts.Program, call: ts.CallExpression, name: string, elseExpression?: ts.Expression) {
	const { typeArguments } = call;
	const value = process.env[name];

	log("TransformLiteral " + name + ": " + value ?? "undefined");

	// has type arguments?
	if (typeArguments) {
		const [litType] = typeArguments;
		if (litType.kind === ts.SyntaxKind.StringKeyword || isStringUnionType(litType)) {
			if (elseExpression && ts.isStringLiteral(elseExpression)) {
				return factory.createAsExpression(
					factory.createStringLiteral(value ?? elseExpression.text),
					factory.createKeywordTypeNode(ts.SyntaxKind.StringKeyword),
				);
			} else if (value) {
				return factory.createAsExpression(
					factory.createStringLiteral(value),
					factory.createKeywordTypeNode(ts.SyntaxKind.StringKeyword),
				);
			}
		} else if (
			(litType.kind === ts.SyntaxKind.NumberKeyword || isNumberUnionType(litType)) &&
			value?.match(jsNumber)
		) {
			if (elseExpression && ts.isNumericLiteral(elseExpression)) {
				return factory.createAsExpression(
					factory.createNumericLiteral(value ?? elseExpression.text),
					factory.createKeywordTypeNode(ts.SyntaxKind.NumberKeyword),
				);
			} else if (value) {
				return factory.createAsExpression(
					factory.createNumericLiteral(value),
					factory.createKeywordTypeNode(ts.SyntaxKind.NumberKeyword),
				);
			}
		} else if (litType.kind === ts.SyntaxKind.BooleanKeyword) {
			if (value !== undefined) {
				return value !== "false" ? factory.createTrue() : factory.createFalse();
			} else if (elseExpression) {
				return elseExpression;
			}
		} else {
			log("TransformLiteralKind NotSupported? " + ts.SyntaxKind[litType.kind]);
		}
	} else {
		if (elseExpression && ts.isStringLiteral(elseExpression)) {
			return factory.createAsExpression(
				factory.createStringLiteral(value ?? elseExpression.text),
				factory.createKeywordTypeNode(ts.SyntaxKind.StringKeyword),
			);
		} else if (value) {
			return factory.createAsExpression(
				factory.createStringLiteral(value),
				factory.createKeywordTypeNode(ts.SyntaxKind.StringKeyword),
			);
		}
	}

	return factory.createIdentifier("undefined");
}

const sourceText = fs.readFileSync(path.join(__dirname, "..", "index.d.ts"), "utf8");
function isEnvModule(sourceFile: ts.SourceFile) {
	return sourceFile.text === sourceText;
}

const imports = new Set<ts.SourceFile>();
function isEnvImportExpression(node: ts.Node, program: ts.Program) {
	if (!ts.isImportDeclaration(node)) {
		return false;
	}

	if (!node.importClause) {
		return false;
	}

	const namedBindings = node.importClause.namedBindings;
	if (!node.importClause.name && !namedBindings) {
		return false;
	}

	const importSymbol = program.getTypeChecker().getSymbolAtLocation(node.moduleSpecifier);

	if (!importSymbol || !isEnvModule(importSymbol.valueDeclaration.getSourceFile())) {
		return false;
	}

	const source = node.getSourceFile();
	if (!imports.has(source)) imports.add(source);
	return true;
}

function handleEnvCallExpression(node: ts.CallExpression, program: ts.Program, name: string) {
	switch (name) {
		case MacroIdentifier.Env: {
			const [arg, orElse] = node.arguments;
			if (ts.isStringLiteral(arg)) {
				return transformLiteral(program, node, arg.text, orElse);
			}
		}
		case MacroIdentifier.IfEnv: {
			const [arg, equals, expression] = node.arguments;
			if (ts.isStringLiteral(arg) && ts.isStringLiteral(equals)) {
				if (!ts.isArrowFunction(expression) && !ts.isFunctionExpression(expression)) {
					warn(
						"Third argument to " +
							MacroIdentifier.IfEnv +
							" expects a function literal, got " +
							ts.SyntaxKind[expression.kind],
					);
					return factory.createEmptyStatement();
				}

				const valueOf = process.env[arg.text] ?? "";
				if (valueOf === equals.text) {
					return factory.createCallExpression(
						factory.createParenthesizedExpression(expression),
						undefined,
						[],
					);
				}

				log(MacroIdentifier.IfEnv + " for " + arg.text + " did not match " + equals.text);
			} else if (ts.isStringLiteral(arg) && ts.isArrayLiteralExpression(equals)) {
				if (!ts.isArrowFunction(expression) && !ts.isFunctionExpression(expression)) {
					throw formatTransformerDiagnostic(
						"Third argument to " +
							MacroIdentifier.IfEnv +
							" expects a function literal, got " +
							ts.SyntaxKind[expression.kind],
						expression,
					);
				}

				for (const element of equals.elements) {
					if (ts.isStringLiteral(element)) {
						const valueOf = process.env[arg.text] ?? "";
						if (valueOf === element.text) {
							return factory.createCallExpression(
								factory.createParenthesizedExpression(expression),
								undefined,
								expression.parameters.length > 0 ? [element] : [],
							);
						}
					}
				}

				return factory.createEmptyStatement();
			} else {
				throw formatTransformerDiagnostic(`Invalid arguments to '${name}'`, node);
			}

			return factory.createEmptyStatement();
		}
	}
}

function visitCallExpression(node: ts.CallExpression, program: ts.Program) {
	const typeChecker = program.getTypeChecker();
	const signature = typeChecker.getResolvedSignature(node);
	if (!signature) {
		return node;
	}
	const { declaration } = signature;
	if (!declaration || ts.isJSDocSignature(declaration) || !isEnvModule(declaration.getSourceFile())) {
		return node;
	}

	const functionName = declaration.name && declaration.name.getText();
	if (!functionName) {
		return node;
	}

	return handleEnvCallExpression(node, program, functionName);
}

function visitNode(node: ts.SourceFile, program: ts.Program): ts.SourceFile;
function visitNode(node: ts.Node, program: ts.Program): ts.Node | undefined;
function visitNode(node: ts.Node, program: ts.Program): ts.Node | ts.Node[] | undefined {
	if (isEnvImportExpression(node, program)) {
		log("Erased import statement");
		return;
	}

	if (!imports.has(node.getSourceFile())) {
		return node;
	}

	if (ts.isCallExpression(node)) {
		return visitCallExpression(node, program);
	}

	return node;
}

interface TransformerConfiguration {
	files?: string[];
	verbose?: boolean;
}

export default function transform(program: ts.Program, configuration: TransformerConfiguration) {
	// Load user custom config paths (if user specifies)
	const { files, verbose } = configuration;
	// load any .env files
	dotenv.config();

	if (verbose !== undefined) {
		verboseLogging = verbose;
	}

	if (files !== undefined) {
		for (const filePath of files) {
			console.log(formatTransformerDebug(`Loaded environment file: ${filePath}`));
			dotenv.config({ path: path.resolve(filePath) });
		}
	}

	return (context: ts.TransformationContext) => (file: ts.SourceFile) => {
		const newSource = visitNodeAndChildren(file, program, context);
		// if (verbose) {
		// 	newSource.fileName = newSource.fileName.replace("([a-z]).(tsx*)$", "$1.emit.$2");
		// 	program.emit(newSource);
		// }
		return newSource;
	};
}
