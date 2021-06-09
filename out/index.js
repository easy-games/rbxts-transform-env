"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    Object.defineProperty(o, k2, { enumerable: true, get: function() { return m[k]; } });
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const typescript_1 = __importStar(require("typescript"));
const dotenv_1 = __importDefault(require("dotenv"));
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const colors_1 = __importDefault(require("colors"));
const shared_1 = require("./shared");
let verboseLogging = false;
function visitNodeAndChildren(node, program, context) {
    return typescript_1.default.visitEachChild(visitNode(node, program), (childNode) => visitNodeAndChildren(childNode, program, context), context);
}
function log(message) {
    if (verboseLogging) {
        console.log(shared_1.formatTransformerDebug(message));
    }
}
function warn(message) {
    process.stdout.write(`[rbxts-transform-env] ${colors_1.default.yellow(message)}\n`);
}
const jsNumber = /^(\d+|0x[0-9A-Fa-f]+|[^_][0-9_]+[^_])$/;
function isNumberUnionType(type) {
    return (typescript_1.default.isUnionTypeNode(type) && type.types.every((v) => typescript_1.default.isLiteralTypeNode(v) && typescript_1.default.isNumericLiteral(v.literal)));
}
function isStringUnionType(type) {
    return (typescript_1.default.isUnionTypeNode(type) && type.types.every((v) => typescript_1.default.isLiteralTypeNode(v) && typescript_1.default.isStringLiteral(v.literal)));
}
function transformLiteral(program, call, name, elseExpression) {
    var _a;
    const { typeArguments } = call;
    const value = process.env[name];
    log((_a = "TransformLiteral " + name + ": " + value) !== null && _a !== void 0 ? _a : "undefined");
    // has type arguments?
    if (typeArguments) {
        const [litType] = typeArguments;
        if (litType.kind === typescript_1.default.SyntaxKind.StringKeyword || isStringUnionType(litType)) {
            if (elseExpression && typescript_1.default.isStringLiteral(elseExpression)) {
                return typescript_1.factory.createAsExpression(typescript_1.factory.createStringLiteral(value !== null && value !== void 0 ? value : elseExpression.text), typescript_1.factory.createKeywordTypeNode(typescript_1.default.SyntaxKind.StringKeyword));
            }
            else if (value) {
                return typescript_1.factory.createAsExpression(typescript_1.factory.createStringLiteral(value), typescript_1.factory.createKeywordTypeNode(typescript_1.default.SyntaxKind.StringKeyword));
            }
        }
        else if ((litType.kind === typescript_1.default.SyntaxKind.NumberKeyword || isNumberUnionType(litType)) && (value === null || value === void 0 ? void 0 : value.match(jsNumber))) {
            if (elseExpression && typescript_1.default.isNumericLiteral(elseExpression)) {
                return typescript_1.factory.createAsExpression(typescript_1.factory.createNumericLiteral(value !== null && value !== void 0 ? value : elseExpression.text), typescript_1.factory.createKeywordTypeNode(typescript_1.default.SyntaxKind.NumberKeyword));
            }
            else if (value) {
                return typescript_1.factory.createAsExpression(typescript_1.factory.createNumericLiteral(value), typescript_1.factory.createKeywordTypeNode(typescript_1.default.SyntaxKind.NumberKeyword));
            }
        }
        else if (litType.kind === typescript_1.default.SyntaxKind.BooleanKeyword) {
            if (value !== undefined) {
                return value !== "false" ? typescript_1.factory.createTrue() : typescript_1.factory.createFalse();
            }
            else if (elseExpression) {
                return elseExpression;
            }
        }
        else {
            log("TransformLiteralKind NotSupported? " + typescript_1.default.SyntaxKind[litType.kind]);
        }
    }
    else {
        if (elseExpression && typescript_1.default.isStringLiteral(elseExpression)) {
            return typescript_1.factory.createAsExpression(typescript_1.factory.createStringLiteral(value !== null && value !== void 0 ? value : elseExpression.text), typescript_1.factory.createKeywordTypeNode(typescript_1.default.SyntaxKind.StringKeyword));
        }
        else if (value) {
            return typescript_1.factory.createAsExpression(typescript_1.factory.createStringLiteral(value), typescript_1.factory.createKeywordTypeNode(typescript_1.default.SyntaxKind.StringKeyword));
        }
    }
    return typescript_1.factory.createIdentifier("undefined");
}
const sourceText = fs_1.default.readFileSync(path_1.default.join(__dirname, "..", "index.d.ts"), "utf8");
function isEnvModule(sourceFile) {
    return sourceFile.text === sourceText;
}
const imports = new Set();
function isEnvImportExpression(node, program) {
    if (!typescript_1.default.isImportDeclaration(node)) {
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
    if (!imports.has(source))
        imports.add(source);
    return true;
}
function handleEnvCallExpression(node, program, name) {
    var _a, _b;
    switch (name) {
        case "$env" /* Env */: {
            const [arg, orElse] = node.arguments;
            if (typescript_1.default.isStringLiteral(arg)) {
                return transformLiteral(program, node, arg.text, orElse);
            }
        }
        case "$ifEnv" /* IfEnv */: {
            const [arg, equals, expression] = node.arguments;
            if (typescript_1.default.isStringLiteral(arg) && typescript_1.default.isStringLiteral(equals)) {
                if (!typescript_1.default.isArrowFunction(expression) && !typescript_1.default.isFunctionExpression(expression)) {
                    warn("Third argument to " +
                        "$ifEnv" /* IfEnv */ +
                        " expects a function literal, got " +
                        typescript_1.default.SyntaxKind[expression.kind]);
                    return typescript_1.factory.createEmptyStatement();
                }
                const valueOf = (_a = process.env[arg.text]) !== null && _a !== void 0 ? _a : "";
                if (valueOf === equals.text) {
                    return typescript_1.factory.createCallExpression(typescript_1.factory.createParenthesizedExpression(expression), undefined, []);
                }
                log("$ifEnv" /* IfEnv */ + " for " + arg.text + " did not match " + equals.text);
            }
            else if (typescript_1.default.isStringLiteral(arg) && typescript_1.default.isArrayLiteralExpression(equals)) {
                if (!typescript_1.default.isArrowFunction(expression) && !typescript_1.default.isFunctionExpression(expression)) {
                    throw shared_1.formatTransformerDiagnostic("Third argument to " +
                        "$ifEnv" /* IfEnv */ +
                        " expects a function literal, got " +
                        typescript_1.default.SyntaxKind[expression.kind], expression);
                }
                for (const element of equals.elements) {
                    if (typescript_1.default.isStringLiteral(element)) {
                        const valueOf = (_b = process.env[arg.text]) !== null && _b !== void 0 ? _b : "";
                        if (valueOf === element.text) {
                            return typescript_1.factory.createCallExpression(typescript_1.factory.createParenthesizedExpression(expression), undefined, expression.parameters.length > 0 ? [element] : []);
                        }
                    }
                }
                return typescript_1.factory.createEmptyStatement();
            }
            else {
                throw shared_1.formatTransformerDiagnostic(`Invalid arguments to '${name}'`, node);
            }
            return typescript_1.factory.createEmptyStatement();
        }
    }
}
function visitCallExpression(node, program) {
    const typeChecker = program.getTypeChecker();
    const signature = typeChecker.getResolvedSignature(node);
    if (!signature) {
        return node;
    }
    const { declaration } = signature;
    if (!declaration || typescript_1.default.isJSDocSignature(declaration) || !isEnvModule(declaration.getSourceFile())) {
        return node;
    }
    const functionName = declaration.name && declaration.name.getText();
    if (!functionName) {
        return node;
    }
    return handleEnvCallExpression(node, program, functionName);
}
function visitNode(node, program) {
    if (isEnvImportExpression(node, program)) {
        log("Erased import statement");
        return;
    }
    if (!imports.has(node.getSourceFile())) {
        return node;
    }
    if (typescript_1.default.isCallExpression(node)) {
        return visitCallExpression(node, program);
    }
    return node;
}
function transform(program, configuration) {
    // Load user custom config paths (if user specifies)
    const { files, verbose } = configuration;
    // load any .env files
    dotenv_1.default.config();
    if (verbose !== undefined) {
        verboseLogging = verbose;
    }
    if (files !== undefined) {
        for (const filePath of files) {
            console.log(shared_1.formatTransformerDebug(`Loaded environment file: ${filePath}`));
            dotenv_1.default.config({ path: path_1.default.resolve(filePath) });
        }
    }
    return (context) => (file) => {
        const newSource = visitNodeAndChildren(file, program, context);
        // if (verbose) {
        // 	newSource.fileName = newSource.fileName.replace("([a-z]).(tsx*)$", "$1.emit.$2");
        // 	program.emit(newSource);
        // }
        return newSource;
    };
}
exports.default = transform;
