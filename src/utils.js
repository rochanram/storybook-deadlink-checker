import { readFileSync, existsSync } from 'fs';
import * as path from 'path';
import mdx from '@mdx-js/mdx';
import slugPlugin from 'remark-slug';
import { remove } from 'unist-util-remove';
import logSymbols from 'log-symbols';
import retus from 'retus';
import micromatch from 'micromatch';

const isMatch = micromatch.isMatch;

const remarkRemoveCodeNodes = () => {
	return function transformer(tree) {
		remove(tree, 'code');
	};
};

const removeMarkdownCodeBlocks = (markdown) => {
	return markdown.replace(/```[\s\S]+?```/g, '');
};

const fillCache = (cache, markdownOrJsx, filePath, filePathAbs) => {
	markdownOrJsx.replace(
		/\s+(?:(?:"(?:id|name)":\s*)|(?:(?:id|name)=))"([^"]+)"/g,
		(str, match) => {
			if (match && match.match) {
				cache[filePathAbs].ids[match] = true;
			}
			// Discard replacement
			return '';
		}
	);

	markdownOrJsx.replace(
		/\s+(?:(?:"(?:href|to|src|path=\/docs\/|path=\/story\/)":\s*)|(?:(?:href|to|src|kind)=))["']([^"']+?)['"]/g,
		(str, match) => {
			if (match && match.match) {
				if (
					!match.match(
						/(^https?:\/\/)|(^#)|(^[^:]+:.*)|(\.mdx?(#[a-zA-Z0-9._,-]*)?$)/
					)
				) {
					if (match.match(/\/$/)) {
						match += 'index.mdx';
					} else if (match.match(/\/#[^/]+$/)) {
						match = match.replace(/(\/)(#[^/]+)$/, '$1index.mdx$2');
					}
				}
				if (
					str.includes('kind=') ||
					str.includes('path=/docs/') ||
					str.includes('path=/story/')
				) {
					const formattedLink = formatLiveLinks(match);
					if (
						!cache[filePathAbs].storybookLinks.includes(
							formattedLink
						)
					) {
						cache[filePathAbs].storybookLinks.push(formattedLink);
					}
				} else if (match.match(/^https?:\/\//)) {
					if (!cache[filePathAbs].externalLinks.includes(match)) {
						cache[filePathAbs].externalLinks.push(match);
					}
				} else if (match.match(/^[^:]+:.*/)) {
					// ignore links such as "mailto:" or "javascript:"
				} else {
					let absolute;

					const isAnchorLink = match.match(/^#/);
					const isRootRelativeLink = match.match(/^\//);

					if (isAnchorLink) {
						match = filePath + match;
						absolute = path.resolve(path.join(match));
					} else {
						const result = filePath.match(/^(.+\/)[^/]+$/);
						const filePathBase = result[1];
						absolute = path.resolve(filePathBase + '/' + match);
					}

					cache[filePathAbs].internalLinks.push({
						original: match,
						absolute,
					});
				}
			}
			// Discard replacement
			return '';
		}
	);
};

export const readFileIntoCache = (cache, filePath) => {
	const filePathAbs = path.resolve(filePath);
	const fileExt = filePath.split('.').pop();

	if (!fileExt || !['mdx', 'md'].includes(fileExt)) {
		return;
	}

	const markdown = removeMarkdownCodeBlocks(
		readFileSync(filePathAbs).toString()
	);

	let jsx = '';

	try {
		jsx = mdx.sync(markdown, {
			remarkPlugins: [slugPlugin, remarkRemoveCodeNodes],
		});
	} catch (e) {
		// Fail if there was an error parsing a mdx/md file
		if (fileExt === 'mdx' || fileExt === 'md') {
			console.error('Unable to parse mdx to jsx: ' + filePath);
			throw e;
		}
	}

	// eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
	if (!cache[filePathAbs]) {
		cache[filePathAbs] = {
			filePath,
			filePathAbs,
			externalLinks: [],
			internalLinks: [],
			storybookLinks: [],
			ids: {},
		};
	}

	fillCache(cache, jsx, filePath, filePathAbs);
	fillCache(cache, markdown, filePath, filePathAbs);
};

export const fetchLinks = (dir, filePaths) => {
	const cache = {};

	filePaths.forEach((relativePath) => {
		const filePath = path.join(dir, relativePath);
		readFileIntoCache(cache, filePath);
	});

	return cache;
};

export const filterArray = (array) => {
	const uniqueSet = new Set(array);
	return [...uniqueSet];
};
export const formatLiveLinks = (link) => {
	let linkPrefix = 'docs';

	if (link.includes('story')) {
		linkPrefix = 'story';
	}

	if (link.includes('?path=/docs/')) {
		link = link.replace('?path=/docs/', '');
	}

	if (link.includes('?path=/story/')) {
		link = link.replace('?path=/story/', '');
	}

	const formattedLink = `${link}&viewMode=${linkPrefix}`;

	return formattedLink;
};

export const checkExternalLinks = (
	filePathAbs,
	externalLinks,
	ignorePattern,
	errorFiles
) => {
	externalLinks.forEach((link) => {
		if (ignorePattern && isMatch(link, ignorePattern)) return;
		try {
			const { statusCode } = retus.get(link, { throwHttpErrors: false });
			//temp fix for unauthorized external links
			if (
				statusCode !== 200 &&
				statusCode !== 201 &&
				statusCode !== 403 &&
				statusCode !== 429
			) {
				throw new Error(`status code received ${statusCode}`);
			}
			console.log(`\t[${logSymbols.success}]`, `${link}`);
		} catch (err) {
			errorFiles.push(filePathAbs);
			console.error(`\t[${logSymbols.error}]`, `${link}`);
			console.error(`\terror message: ${err.message}`);
		}
	});
};

export const checkInternalLinks = (
	linkCache,
	filePathAbs,
	internalLinks,
	ignorePattern,
	errorFiles
) => {
	internalLinks.forEach((link) => {
		if (ignorePattern && isMatch(link.original, ignorePattern)) return;

		const [targetFile, targetId] = link.absolute.split('#');

		if (
			targetId &&
			linkCache[targetFile] &&
			linkCache[targetFile].ids[targetId]
		) {
			console.log(`\t[${logSymbols.success}]`, `#${targetId}`);
		}

		if (!linkCache[targetFile]) {
			if (existsSync(targetFile)) {
				readFileIntoCache(linkCache, targetFile);
				console.log(
					`\t[${logSymbols.success}]`,
					targetId ? `#${targetId}` : link.original
				);
			} else {
				errorFiles.push(filePathAbs);
				console.error(
					`\t[${logSymbols.error}]`,
					targetId ? `#${targetId}` : link.original
				);
			}
		}

		if (
			targetId &&
			(!linkCache[targetFile] || !linkCache[targetFile].ids[targetId])
		) {
			errorFiles.push(filePathAbs);
			console.error(
				`\t[${logSymbols.error}]`,
				targetId ? `#${targetId}` : link.original
			);
		}
	});
};
