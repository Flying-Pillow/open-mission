---
layout: default
title: Reference
nav_order: 6
has_children: true
---

# Reference

<section class="mission-section-hero">
	<span class="mission-section-kicker">Exact Surface</span>
	<div class="mission-section-title">Use reference pages when you need the literal current contract.</div>
	<p class="mission-section-lead">These pages stay close to the running implementation: public CLI entry points, persisted state boundaries, and the facts that should remain exact even when the product narrative pages stay higher level.</p>
</section>

<div class="mission-section-grid">
	<a class="mission-section-card" href="{{ '/reference/operator-command-model.html' | relative_url }}">
		<span class="mission-section-card__eyebrow">Control Model</span>
		<span class="mission-section-card__title">Operator Command Model</span>
		<span class="mission-section-card__text">Read the decision tables for mission, stage, task, artifact, and agentrunner commands, including rules, context, and expected results.</span>
	</a>
	<a class="mission-section-card" href="{{ '/reference/cli-commands.html' | relative_url }}">
		<span class="mission-section-card__eyebrow">CLI Surface</span>
		<span class="mission-section-card__title">CLI Commands</span>
		<span class="mission-section-card__text">See the supported public commands, what they do today, and which helpers are still internal.</span>
	</a>
	<a class="mission-section-card" href="{{ '/reference/product-comparison.html' | relative_url }}">
		<span class="mission-section-card__eyebrow">Landscape</span>
		<span class="mission-section-card__title">Product Comparison</span>
		<span class="mission-section-card__text">Compare Mission with Spec Kit, BMAD, and GSD across workflow shape, control model, context handling, and recovery.</span>
	</a>
	<a class="mission-section-card" href="{{ '/reference/state-schema.html' | relative_url }}">
		<span class="mission-section-card__eyebrow">Runtime Model</span>
		<span class="mission-section-card__title">State Schema</span>
		<span class="mission-section-card__text">Understand the separation between repository control state, daemon projections, and mission-local execution state.</span>
	</a>
</div>