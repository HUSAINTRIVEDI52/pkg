import js from "@eslint/js";
import tseslint from "@typescript-eslint/eslint-plugin";
import tsparser from "@typescript-eslint/parser";

export default [
    js.configs.recommended,
    {
        files: ["**/*.js", "**/*.mjs", "**/*.cjs"],
        ...js.configs.recommended,
    },
    {
        files: ["**/*.ts", "**/*.tsx"],
        languageOptions: {
            parser: tsparser,
            parserOptions: {
                ecmaVersion: "latest",
                sourceType: "module",
                project: "./tsconfig.json"
            }
        },
        plugins: {
            "@typescript-eslint": tseslint
        },
        rules: {
            ...tseslint.configs.recommended.rules,
            "no-unused-vars": "off",
            "@typescript-eslint/no-unused-vars": ["warn", { 
                "varsIgnorePattern": "^React$",
                "argsIgnorePattern": "^_" 
            }]
        }
    },
    {
        rules: {
            "no-unused-vars": ["warn", { 
                "varsIgnorePattern": "^React$",
                "argsIgnorePattern": "^_" 
            }],
            "no-undef": "error"
        },
        languageOptions: {
            ecmaVersion: "latest",
            sourceType: "module",
            globals: {
                React: "readonly",
                process: "readonly",
                __dirname: "readonly",
                module: "readonly",
                require: "readonly",
                console: "readonly",
                Buffer: "readonly",
                exports: "readonly"
            }
        }
    }
];
