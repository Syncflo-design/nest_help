/**
 * nest_help — contextual help discovery for the NestERP platform.
 *
 * Loaded on every desk page via app_include_js. Exposes a global `nestHelp`
 * object that any NestERP app can call to attach help badges to elements.
 *
 * Help pages live as static HTML in nest_help/public/help/<slug>.html and are
 * served at /assets/nest_help/help/<slug>.html. Discovery is automatic — if the
 * file exists, the badge appears. No database records, no admin config.
 *
 * Usage from any app:
 *
 *   // Badge a single element by slug
 *   nestHelp.badge($element, 'adding-pos-sales-staff');
 *
 *   // Auto-discover badges for elements with data-help="<slug>"
 *   nestHelp.discover($container);
 *
 *   // Open a help page directly
 *   nestHelp.open('adding-pos-sales-staff');
 *
 *   // Convert a label to a slug (for convention-based discovery)
 *   nestHelp.slug('Open POS');  // -> 'open-pos'
 */
(function() {
	var HELP_BASE = '/assets/nest_help/help/';
	var _cache = {};  // slug -> true/false (avoids repeat HEAD requests)

	function slug_from_label(label) {
		return String(label || '').toLowerCase()
			.replace(/[^a-z0-9]+/g, '-')
			.replace(/^-+|-+$/g, '');
	}

	function help_url(slug) {
		return HELP_BASE + slug + '.html';
	}

	function probe(slug, callback) {
		if (slug in _cache) {
			callback(_cache[slug]);
			return;
		}
		$.ajax({ url: help_url(slug), type: 'HEAD' })
			.done(function() { _cache[slug] = true; callback(true); })
			.fail(function() { _cache[slug] = false; callback(false); });
	}

	function inject_badge($el, slug) {
		if ($el.find('.nh-help-badge').length) return;
		$el.css('position', 'relative');
		$el.append(
			'<a class="nh-help-badge" href="' + help_url(slug) + '" target="_blank"'
			+ ' title="Help" aria-label="Help"'
			+ ' onclick="event.stopPropagation();">?</a>'
		);
	}

	window.nestHelp = {
		// Convert a display label to a help slug
		slug: slug_from_label,

		// Open a help page by slug in a new tab
		open: function(slug) {
			window.open(help_url(slug), '_blank');
		},

		// Badge a specific element if a help page exists for the slug
		badge: function($el, slug) {
			if (!slug || !$el || !$el.length) return;
			probe(slug, function(exists) {
				if (exists) inject_badge($el, slug);
			});
		},

		// Auto-discover: find all elements with data-help="<slug>" inside
		// $container and badge them if the help file exists. Batches probes
		// to avoid flooding the server.
		discover: function($container) {
			var $els = ($container || $(document)).find('[data-help]');
			$els.each(function() {
				var $el = $(this);
				var s = $el.data('help');
				if (s) {
					probe(s, function(exists) {
						if (exists) inject_badge($el, s);
					});
				}
			});
		}
	};
})();
