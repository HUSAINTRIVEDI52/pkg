import js from "@eslint/js";

// Common globals for JS/TS projects
const commonGlobals = {
    React: "readonly",
    process: "readonly",
    __dirname: "readonly",
    __filename: "readonly",
    module: "readonly",
    require: "readonly",
    console: "readonly",
    Buffer: "readonly",
    exports: "readonly",
    setTimeout: "readonly",
    clearTimeout: "readonly",
    setInterval: "readonly",
    clearInterval: "readonly",
};

// Try to load TypeScript ESLint support — only used if TS packages are installed
let tseslint = null;
let tsparser = null;
try {
    tseslint = (await import("@typescript-eslint/eslint-plugin")).default;
    tsparser = (await import("@typescript-eslint/parser")).default;
} catch {
    // TypeScript ESLint not installed — JS-only mode
}

const jsConfig = {
    files: ["**/*.js", "**/*.mjs", "**/*.cjs", "**/*.jsx"],
    ...js.configs.recommended,
    rules: {
        ...js.configs.recommended.rules,
        // Console rules
        "no-console": "warn",
        // Variable declaration rules
        "no-undef": "error",
        "no-unused-vars": ["warn", {
            "varsIgnorePattern": "^React$",
            "argsIgnorePattern": "^_"
        }],
        "prefer-const": "error",
        // Comparison rules
        "eqeqeq": "error",
        // Style rules
        "indent": ["error", 2],
        "quotes": ["error", "single"],
        "semi": ["error", "always"],
    },
    languageOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
        globals: commonGlobals,
    },
};

const tsConfig = (tseslint && tsparser) ? {
    files: ["**/*.ts", "**/*.tsx"],
    languageOptions: {
        parser: tsparser,
        parserOptions: {
            ecmaVersion: "latest",
            sourceType: "module",
        },
    },
    plugins: {
        "@typescript-eslint": tseslint,
    },
    rules: {
        ...tseslint.configs.recommended.rules,
        // Console rules
        "no-console": "warn",
        // Variable declaration rules
        "no-unused-vars": "off",
        "@typescript-eslint/no-unused-vars": ["warn", {
            "varsIgnorePattern": "^React$",
            "argsIgnorePattern": "^_"
        }],
        "@typescript-eslint/no-undef": "error",
        "prefer-const": "error",
        // Comparison rules
        "eqeqeq": "error",
        // Style rules
        "indent": ["error", 2],
        "quotes": ["error", "single"],
        "semi": ["error", "always"],
    },
} : null;

export default [
    js.configs.recommended,
    jsConfig,
    ...(tsConfig ? [tsConfig] : []),
];
