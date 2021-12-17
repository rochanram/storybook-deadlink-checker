import { existsSync } from 'fs';
import retus from 'retus';
import chalk from 'chalk';
import logSymbols from 'log-symbols';
import micromatch from 'micromatch';
import { validateSidebarLinks } from './scrapper.js';
import { readFileIntoCache } from './utils.js';

const isMatch = micromatch.isMatch;

export const checkLinks = async (linkCache, storybookURL, ignorePattern) => {
	const errorFiles = [];

	for (const file in linkCache) {
		const { storybookLinks, externalLinks, internalLinks, filePathAbs } =
			linkCache[file];

		console.log(chalk.cyan(`FILE: ${filePathAbs}`));

		// validate external links are valid using link - checker
		externalLinks.forEach((link) => {
			try {
				retus.head(link, {
					throwHttpErrors: true,
				});
				console.log(`\t[${logSymbols.success}]`, `${link}`);
			} catch {
				errorFiles.push(filePathAbs);
				console.log(`\t[${logSymbols.error}]`, `${link}`);
			}
		});

		internalLinks.forEach((link) => {
			if (ignorePattern && isMatch(link.original, ignorePattern)) return;

			const [targetFile, targetId] = link.absolute.split('#');

			if (
				targetId &&
				linkCache[targetFile] &&
				linkCache[targetFile].ids[targetId]
			) {
				console.log(`\t[${logSymbols.success}]`, `${link.original}`);
			}

			if (!linkCache[targetFile]) {
				if (existsSync(targetFile)) {
					console.log(`targetFile: ${targetFile}`);
					readFileIntoCache(linkCache, targetFile);
					console.log(
						`\t[${logSymbols.success}]`,
						`${link.original}`
					);
				} else {
					errorFiles.push(filePathAbs);
					console.log(`\t[${logSymbols.error}]`, `${link.original}`);
				}
			}

			if (
				targetId &&
				(!linkCache[targetFile] || !linkCache[targetFile].ids[targetId])
			) {
				errorFiles.push(filePathAbs);
				console.log(`\t[${logSymbols.error}]`, `${link.original}`);
			}
		});

		if (storybookURL) {
			await validateSidebarLinks(
				storybookURL,
				storybookLinks,
				filePathAbs,
				errorFiles
			);
		}
	}

	return errorFiles;
};