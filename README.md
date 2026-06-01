# nest_help

Contextual help system for the NestERP platform.

Drop HTML help pages in `nest_help/public/help/` and any NestERP app can auto-discover and display `?` help badges on its UI elements.

## How it works

- Help pages are static HTML files served at `/assets/nest_help/help/<slug>.html`
- `nest_help.js` loads on every desk page and exposes `window.nestHelp`
- Any app adds `data-help="<slug>"` to elements and calls `nestHelp.discover($container)`
- If the file exists, a `?` badge appears automatically — no config needed

## Adding a help page

1. Create `nest_help/public/help/<slug>.html`
2. Push and deploy
3. The badge appears on any element with the matching `data-help` attribute

## License

MIT
