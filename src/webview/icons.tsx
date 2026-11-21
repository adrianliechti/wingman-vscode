import type { ReactNode } from 'react';

// Webviews do not get the editor's icon font, so the few icons are drawn here.
function Icon({ children }: { children: ReactNode }) {
	return (
		<svg className="icon" viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
			{children}
		</svg>
	);
}

export const SendIcon = () => <Icon><path d="M8 13V3.5M3.5 8 8 3.5 12.5 8" /></Icon>;
export const StopIcon = () => <Icon><rect x="4.25" y="4.25" width="7.5" height="7.5" rx="1.2" fill="currentColor" stroke="none" /></Icon>;
export const CopyIcon = () => <Icon><rect x="5.5" y="5.5" width="8" height="8" rx="1.5" /><path d="M10.5 5.5v-1A1.5 1.5 0 0 0 9 3H4.5A1.5 1.5 0 0 0 3 4.5V9a1.5 1.5 0 0 0 1.5 1.5h1" /></Icon>;
export const CheckIcon = () => <Icon><path d="m3.5 8.5 3 3 6-7" /></Icon>;
export const CrossIcon = () => <Icon><path d="m4.5 4.5 7 7m0-7-7 7" /></Icon>;
export const ChevronIcon = () => <Icon><path d="m6 4 4 4-4 4" /></Icon>;
export const Spinner = () => <span className="spinner" role="status" aria-label="Running" />;
