import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default {
    resolve: {
        alias: [
            {
                find: /^@asciiz\/atoolkit\/(.*)\.js$/,
                replacement: path.resolve(__dirname, "Atoolkit/$1.ts"),
            },
            {
                find: /^@asciiz\/atoolkit\/(.*)$/,
                replacement: path.resolve(__dirname, "Atoolkit/$1"),
            },
            {
                find: "@asciiz/atoolkit",
                replacement: path.resolve(__dirname, "Atoolkit/index.ts"),
            },
            {
                find: "@asciiz/weebgfx",
                replacement: path.resolve(__dirname, "WeebGfx/index.ts"),
            },
        ],
    },
};
