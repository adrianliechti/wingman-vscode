import { renderTokens, tokenize, type HighlightRenderNode } from '@tanstack/highlight';
import { parseCodeFenceMeta } from '@tanstack/highlight/markdown';
import { streamingMarkdownExtension } from '@tanstack/markdown/extensions/streaming';
import { Markdown as TanStackMarkdown, type MarkdownComponentProps, type MarkdownComponents } from '@tanstack/markdown/react';
import {
	Children,
	createContext,
	isValidElement,
	memo,
	useContext,
	useEffect,
	useRef,
	useState,
	type MouseEvent,
	type ReactElement,
	type ReactNode,
} from 'react';

import { CheckIcon, CopyIcon } from './icons';

// The streaming extension renders a block that is still being written, such
// as an unclosed code fence, the way it will look once complete.
const extensions = [streamingMarkdownExtension()];

/** Opens a link's target in the editor or the browser; the webview itself never navigates. */
export const LinkContext = createContext<(href: string) => void>(() => { });

function nodeText(node: ReactNode): string {
	return Children.toArray(node)
		.map(child => typeof child === 'string' || typeof child === 'number'
			? String(child)
			: isValidElement<{ children?: ReactNode }>(child) ? nodeText(child.props.children) : '')
		.join('');
}

function highlighted(code: string, language: string, options: ReturnType<typeof parseCodeFenceMeta>): ReactNode[] {
	// tokenize keeps the source text exactly, so the copied code is what was written.
	const render = (node: HighlightRenderNode, key: number): ReactNode => node.type === 'text'
		? node.value
		: <span key={key} className={node.classNames.join(' ')} data-line={node.data?.line}>{node.children.map(render)}</span>;
	return renderTokens(tokenize(code, { lang: language }).tokens, options).map(render);
}

type CodeBlockProps = MarkdownComponentProps<'pre'> & {
	'data-code-title'?: string;
	'data-filename'?: string;
	'data-lang'?: string;
	'data-meta'?: string;
};

function CodeBlock({ children, ...props }: CodeBlockProps) {
	const element = Children.toArray(children).find(
		(child): child is ReactElement<{ children?: ReactNode }> => isValidElement<{ children?: ReactNode }>(child),
	);
	const code = element ? nodeText(element.props.children) : '';
	const language = props['data-lang'] ?? 'plaintext';
	const fence = parseCodeFenceMeta(props['data-meta']);
	const label = props['data-filename'] ?? props['data-code-title'] ?? fence.title ?? language;
	const [copied, setCopied] = useState(false);
	const timer = useRef<number | undefined>(undefined);
	useEffect(() => () => window.clearTimeout(timer.current), []);

	const copy = () => {
		void navigator.clipboard.writeText(code).then(() => {
			setCopied(true);
			window.clearTimeout(timer.current);
			timer.current = window.setTimeout(() => setCopied(false), 1500);
		});
	};

	return (
		<div className="code">
			<div className="code-header">
				<span>{label}</span>
				<button type="button" className="icon-button" onClick={copy} title={copied ? 'Copied' : 'Copy code'} aria-label={copied ? 'Code copied' : 'Copy code'}>
					{copied ? <CheckIcon /> : <CopyIcon />}
				</button>
			</div>
			<pre className={fence.lineNumbers ? 'th-code--line-numbers' : undefined}>
				<code className={`language-${language}`}>{highlighted(code, language, fence)}</code>
			</pre>
		</div>
	);
}

export function Link({ href, children, ...props }: MarkdownComponentProps<'a'>) {
	const open = useContext(LinkContext);
	const click = (event: MouseEvent<HTMLAnchorElement>) => {
		// In-page anchors scroll; everything else is opened by the editor.
		if (href && !href.startsWith('#')) {
			event.preventDefault();
			open(href);
		}
	};
	return <a {...props} href={href} onClick={click}>{children}</a>;
}

const components = {
	a: Link,
	pre: CodeBlock,
	table({ children, ...props }: MarkdownComponentProps<'table'>) {
		return <div className="table-scroll"><table {...props}>{children}</table></div>;
	},
} satisfies MarkdownComponents;

export const Markdown = memo(function Markdown({ text }: { text: string }) {
	if (!text.trim()) {
		return null;
	}
	return (
		<div className="markdown">
			<TanStackMarkdown components={components} extensions={extensions} frontmatter={false} headingIds={false}>
				{text}
			</TanStackMarkdown>
		</div>
	);
});
