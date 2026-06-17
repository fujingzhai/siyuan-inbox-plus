import { resolve } from "path"
import { defineConfig } from "vite"
import minimist from "minimist"
import { viteStaticCopy } from "vite-plugin-static-copy"
import livereload from "rollup-plugin-livereload"
import zipPack from "vite-plugin-zip-pack";
import fg from 'fast-glob';

import vitePluginYamlI18n from './yaml-plugin';

const args = minimist(process.argv.slice(2))
const isWatch = args.watch || args.w || false
const devDistDir = "dev"
const distDir = isWatch ? devDistDir : "dist"

console.log("isWatch=>", isWatch)
console.log("distDir=>", distDir)

export default defineConfig({
    resolve: {
        alias: {
            "@": resolve(__dirname, "src"),
        }
    },

    plugins: [
        vitePluginYamlI18n({
            inDir: 'public/i18n',
            outDir: `${distDir}/i18n`
        }),

        viteStaticCopy({
            targets: [
                {
                    src: "./README*.md",
                    dest: "./",
                },
                {
                    src: "./plugin.json",
                    dest: "./",
                },
                {
                    src: "./icon.png",
                    dest: "./",
                },
                {
                    src: "./preview.png",
                    dest: "./",
                },
                {
                    src: "./LICENSE",
                    dest: "./",
                }
            ],
        }),
    ],

    define: {
        "process.env.DEV_MODE": `"${isWatch}"`,
        "process.env.NODE_ENV": JSON.stringify(process.env.NODE_ENV)
    },

    build: {
        outDir: distDir,
        emptyOutDir: false,
        sourcemap: false,
        minify: !isWatch,

        lib: {
            entry: resolve(__dirname, "src/index.ts"),
            fileName: "index",
            formats: ["cjs"],
        },
        rollupOptions: {
            plugins: [
                ...(
                    isWatch ? [
                        livereload(devDistDir),
                        {
                            name: 'watch-external',
                            async buildStart() {
                                const files = await fg([
                                    'public/i18n/**',
                                    './README*.md',
                                    './plugin.json'
                                ]);
                                for (let file of files) {
                                    this.addWatchFile(file);
                                }
                            }
                        }
                    ] : [
                        zipPack({
                            inDir: './dist',
                            outDir: './',
                            outFileName: 'package.zip'
                        })
                    ]
                )
            ],

            external: ["siyuan", "process"],

            output: {
                entryFileNames: "[name].js",
                assetFileNames: (assetInfo) => {
                    if (assetInfo.name === "style.css") {
                        return "index.css"
                    }
                    return assetInfo.name
                },
            },
        },
    }
})
