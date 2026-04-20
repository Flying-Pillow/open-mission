<script lang="ts">
	import type { Snippet } from "svelte";

	type Props = {
		children: Snippet;
	};

	let { children }: Props = $props();
</script>

<article class="docs-content">
	{@render children()}
</article>

<style>
	.docs-content {
		color: var(--foreground);
	}

	.docs-content :global(h1),
	.docs-content :global(h2),
	.docs-content :global(h3),
	.docs-content :global(h4) {
		color: var(--foreground);
		font-weight: 650;
		letter-spacing: -0.03em;
	}

	.docs-content :global(h1) {
		margin: 0;
		font-size: clamp(2.2rem, 4vw, 3.7rem);
		line-height: 1;
	}

	.docs-content :global(h2) {
		margin: 3rem 0 1rem;
		font-size: clamp(1.65rem, 2.8vw, 2.2rem);
		line-height: 1.15;
	}

	.docs-content :global(h3) {
		margin: 2.25rem 0 0.85rem;
		font-size: 1.3rem;
		line-height: 1.2;
	}

	.docs-content :global(h4) {
		margin: 1.8rem 0 0.75rem;
		font-size: 1.05rem;
		line-height: 1.3;
	}

	.docs-content :global(p),
	.docs-content :global(ul),
	.docs-content :global(ol),
	.docs-content :global(table),
	.docs-content :global(blockquote) {
		margin: 1rem 0;
		font-size: 1.03rem;
		line-height: 1.8;
	}

	.docs-content :global(ul),
	.docs-content :global(ol) {
		padding-left: 1.4rem;
	}

	.docs-content :global(li + li) {
		margin-top: 0.3rem;
	}

	.docs-content :global(a) {
		color: color-mix(in oklab, var(--primary) 82%, black 18%);
		text-decoration: underline;
		text-underline-offset: 0.18em;
	}

	.docs-content :global(a:hover) {
		color: var(--foreground);
	}

	.docs-content :global(strong) {
		color: var(--foreground);
	}

	.docs-content :global(code) {
		border-radius: 0.45rem;
		background: color-mix(in oklab, var(--muted) 78%, white 22%);
		padding: 0.14em 0.38em;
		font-size: 0.94em;
	}

	.docs-content :global(pre) {
		overflow-x: auto;
		border-radius: 1rem;
		border: 1px solid color-mix(in oklab, var(--border) 75%, black 8%);
		background: color-mix(in oklab, var(--card) 82%, black 10%);
		padding: 1rem 1.1rem;
		box-shadow: 0 20px 44px rgba(62, 17, 74, 0.08);
	}

	.docs-content :global(pre code) {
		background: transparent;
		padding: 0;
	}

	.docs-content :global(blockquote) {
		border-left: 4px solid #d10ef0;
		border-radius: 0 1rem 1rem 0;
		background: linear-gradient(
			180deg,
			rgba(255, 240, 255, 0.9),
			rgba(255, 247, 255, 0.9)
		);
		padding: 1rem 1.2rem;
	}

	.docs-content :global(table) {
		width: 100%;
		border-collapse: collapse;
		overflow: hidden;
		border-radius: 1rem;
		box-shadow: 0 18px 50px rgba(62, 17, 74, 0.08);
	}

	.docs-content :global(th),
	.docs-content :global(td) {
		border: 1px solid color-mix(in oklab, var(--border) 82%, black 8%);
		padding: 0.75rem 0.9rem;
		text-align: left;
		vertical-align: top;
	}

	.docs-content :global(th) {
		background: color-mix(in oklab, var(--muted) 75%, white 25%);
		font-weight: 650;
	}

	.docs-content :global(tbody tr:nth-child(even)) {
		background: #fff4ff;
	}

	.docs-content :global(hr) {
		margin: 2rem 0;
		border: 0;
		border-top: 1px solid color-mix(in oklab, var(--border) 82%, black 10%);
	}

	.docs-content :global(.btn) {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		border-radius: 999px;
		border: 1px solid rgba(255, 248, 255, 0.14);
		background: rgba(255, 248, 255, 0.08);
		padding: 0.8rem 1.1rem;
		color: #fff8ff;
		text-decoration: none;
	}

	.docs-content :global(.btn-primary) {
		border: 0;
		background-image: linear-gradient(135deg, #d10ef0, #8b12a0);
		color: #fff8ff;
	}

	.docs-content :global(.mission-home-hero) {
		position: relative;
		margin: 0.4rem 0 2.5rem;
		overflow: hidden;
		border-radius: 1.75rem;
		background:
			radial-gradient(circle at top left, rgba(209, 14, 240, 0.2), transparent 30%),
			linear-gradient(135deg, #17081a 0%, #2d0f33 50%, #17081a 100%);
		padding: 2rem;
		color: #fff8ff;
		box-shadow: 0 30px 80px rgba(44, 12, 52, 0.28);
	}

	.docs-content :global(.mission-home-title) {
		margin: 0 0 0.85rem;
		font-size: clamp(2.4rem, 4vw, 4rem);
		line-height: 1;
		letter-spacing: -0.04em;
		font-weight: 800;
		color: #fff8ff;
	}

	.docs-content :global(.mission-home-kicker),
	.docs-content :global(.mission-section-kicker),
	.docs-content :global(.mission-section-card__eyebrow),
	.docs-content :global(.mission-video-link__eyebrow) {
		display: inline-block;
		border-radius: 999px;
		font-size: 0.75rem;
		font-weight: 700;
		letter-spacing: 0.12em;
		text-transform: uppercase;
	}

	.docs-content :global(.mission-home-kicker) {
		margin-bottom: 0.9rem;
		padding: 0.38rem 0.75rem;
		background: rgba(255, 248, 255, 0.1);
		color: #ffd8ff;
	}

	.docs-content :global(.mission-home-tagline) {
		max-width: 42rem;
		margin: 0 0 1.25rem;
		font-size: 1.15rem;
		color: rgba(255, 248, 255, 0.9);
	}

	.docs-content :global(.mission-home-actions) {
		display: flex;
		flex-wrap: wrap;
		gap: 0.85rem;
		margin-top: 1.25rem;
	}

	.docs-content :global(.mission-home-grid),
	.docs-content :global(.mission-section-grid),
	.docs-content :global(.mission-comparison-grid),
	.docs-content :global(.mission-status-grid) {
		display: grid;
		gap: 1rem;
		margin: 1.5rem 0 2rem;
	}

	.docs-content :global(.mission-home-grid) {
		grid-template-columns: repeat(3, minmax(0, 1fr));
		margin-top: 1.8rem;
	}

	.docs-content :global(.mission-section-grid) {
		grid-template-columns: repeat(2, minmax(0, 1fr));
		margin-top: 1.8rem;
	}

	.docs-content :global(.mission-section-grid--three) {
		grid-template-columns: repeat(3, minmax(0, 1fr));
	}

	.docs-content :global(.mission-comparison-grid) {
		grid-template-columns: repeat(2, minmax(0, 1fr));
	}

	.docs-content :global(.mission-status-grid) {
		grid-template-columns: repeat(auto-fit, minmax(15rem, 1fr));
	}

	.docs-content :global(.mission-home-card),
	.docs-content :global(.mission-section-card),
	.docs-content :global(.mission-comparison-card),
	.docs-content :global(.mission-status-card),
	.docs-content :global(.mission-compare-callout),
	.docs-content :global(.mission-video-embed) {
		border: 1px solid rgba(138, 18, 160, 0.12);
		box-shadow: 0 16px 40px rgba(62, 17, 74, 0.06);
	}

	.docs-content :global(.mission-home-card) {
		border-color: rgba(255, 248, 255, 0.1);
		background: rgba(255, 248, 255, 0.08);
		padding: 1.1rem 1rem;
		color: #fff8ff;
	}

	.docs-content :global(.mission-home-card span) {
		color: rgba(255, 248, 255, 0.78);
	}

	.docs-content :global(.mission-section-hero) {
		position: relative;
		margin: 0 0 2rem;
		overflow: hidden;
		border-radius: 1.5rem;
		border: 1px solid rgba(138, 18, 160, 0.1);
		background:
			radial-gradient(circle at top left, rgba(209, 14, 240, 0.16), transparent 32%),
			linear-gradient(135deg, #fff9ff 0%, #fdf1ff 100%);
		padding: 1.6rem 1.5rem;
		box-shadow: 0 22px 50px rgba(62, 17, 74, 0.07);
	}

	.docs-content :global(.mission-section-kicker) {
		margin-bottom: 0.75rem;
		padding: 0.3rem 0.65rem;
		background: rgba(209, 14, 240, 0.08);
		color: #8b12a0;
	}

	.docs-content :global(.mission-section-title) {
		margin: 0 0 0.7rem;
		font-size: clamp(1.8rem, 3.1vw, 2.6rem);
		line-height: 1.05;
		letter-spacing: -0.04em;
		color: #17081a;
	}

	.docs-content :global(.mission-section-lead) {
		max-width: 44rem;
		margin: 0;
		color: #4d2457;
		font-size: 1.06rem;
	}

	.docs-content :global(.mission-section-card),
	.docs-content :global(.mission-comparison-card) {
		display: block;
		border-radius: 1.2rem;
		background: #ffffff;
		padding: 1.15rem 1.1rem;
		color: inherit;
		text-decoration: none;
	}

	.docs-content :global(.mission-status-card),
	.docs-content :global(.mission-compare-callout) {
		border-radius: 1rem;
		background: linear-gradient(
			180deg,
			rgba(255, 240, 255, 0.92),
			rgba(255, 248, 255, 0.96)
		);
		padding: 1rem 1.1rem;
	}

	.docs-content :global(.mission-status-card--current) {
		border-color: rgba(22, 126, 114, 0.22);
		background: linear-gradient(
			180deg,
			rgba(236, 255, 250, 0.98),
			rgba(247, 255, 252, 0.98)
		);
	}

	.docs-content :global(.mission-status-card--target) {
		border-color: rgba(180, 115, 8, 0.22);
		background: linear-gradient(
			180deg,
			rgba(255, 248, 231, 0.98),
			rgba(255, 252, 244, 0.98)
		);
	}

	.docs-content :global(.mission-table-scroll) {
		margin: 1.5rem 0 2rem;
		overflow-x: auto;
	}

	.docs-content :global(.mission-table-scroll table) {
		min-width: 100%;
		margin: 0;
	}

	.docs-content :global(.mission-video-embed) {
		border-radius: 1.2rem;
		background: linear-gradient(
			180deg,
			rgba(255, 240, 255, 0.92),
			rgba(255, 248, 255, 0.96)
		);
		padding: 0.8rem;
	}

	.docs-content :global(.mission-video-link) {
		display: grid;
		grid-template-columns: minmax(12rem, 18rem) minmax(0, 1fr);
		gap: 1rem;
		align-items: stretch;
		color: inherit;
		text-decoration: none;
	}

	.docs-content :global(.mission-video-link__poster) {
		display: block;
		width: 100%;
		aspect-ratio: 16 / 9;
		border-radius: 0.9rem;
		background: #17081a center / cover no-repeat;
	}

	.docs-content :global(.mission-video-link__body) {
		display: flex;
		min-width: 0;
		flex-direction: column;
		justify-content: center;
		gap: 0.45rem;
	}

	.docs-content :global(.mission-video-link__title) {
		font-size: 1.15rem;
		line-height: 1.15;
		font-weight: 700;
		color: #17081a;
	}

	.docs-content :global(.mission-video-link__text),
	.docs-content :global(.mission-status-card p),
	.docs-content :global(.mission-compare-callout p),
	.docs-content :global(.mission-comparison-card p),
	.docs-content :global(.mission-section-card__text) {
		margin: 0;
		color: #583062;
	}

	@media (max-width: 74rem) {
		.docs-content :global(.mission-home-grid),
		.docs-content :global(.mission-section-grid),
		.docs-content :global(.mission-section-grid--three),
		.docs-content :global(.mission-comparison-grid),
		.docs-content :global(.mission-video-link) {
			grid-template-columns: 1fr;
		}
	}

	@media (max-width: 50rem) {
		.docs-content :global(.mission-home-hero) {
			border-radius: 1.25rem;
			padding: 1.4rem;
		}

		.docs-content :global(.mission-home-actions) {
			flex-direction: column;
		}

		.docs-content :global(.mission-home-actions .btn) {
			width: 100%;
			text-align: center;
		}
	}
</style>
