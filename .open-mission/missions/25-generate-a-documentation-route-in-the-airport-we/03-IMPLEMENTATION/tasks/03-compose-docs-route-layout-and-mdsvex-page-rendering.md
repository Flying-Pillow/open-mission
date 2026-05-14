---
dependsOn: ["implementation/02-build-docs-manifest-navigation-and-page-resolution"]
---

# Compose Docs Route Layout And Mdsvex Page Rendering

Create the dedicated `/docs` route surface inside Airport web, including the docs layout loader, docs frame components, and the catch-all page that mounts the resolved mdsvex component with docs-specific chrome and metadata. This slice should render long-form content through a docs content wrapper, surface normalized page title and description data, and keep docs presentation isolated from repository and mission operation views.

