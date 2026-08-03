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

	// Route-based help buttons — injected into page toolbars where
	// data-help attributes aren't available (Frappe built-in pages).
	var ROUTE_HELP = {
		'Form/Data Export/Data Export': 'data-export'
	};

	// Route-specific page setup — defaults, pre-fills, etc.
	var ROUTE_DEFAULTS = {
		'Form/Data Export/Data Export': function() {
			// Default DocType to Item if not already set
			setTimeout(function() {
				var f = cur_frm && cur_frm.fields_dict && cur_frm.fields_dict.reference_doctype;
				if (f && !f.get_value()) f.set_value('Item');
			}, 800);
		}
	};

	function check_route_help() {
		var route = (frappe.get_route() || []).join('/');
		var slug = ROUTE_HELP[route];

		// Run route defaults
		if (ROUTE_DEFAULTS[route]) ROUTE_DEFAULTS[route]();

		if (!slug) return;
		// Avoid duplicates
		if ($('.nh-page-help-btn').length) return;
		probe(slug, function(exists) {
			if (!exists) return;
			// Reuse Frappe's own button classes so height/padding/baseline
			// match the primary action exactly; nh-page-help-btn only recolours.
			var $btn = $('<button class="btn btn-sm nh-page-help-btn" title="Help">'
				+ '? Help</button>');
			$btn.on('click', function() {
				window.open(help_url(slug), '_blank');
			});
			// Insert just before the visible primary action button in the header
			var $primary = $('.primary-action:visible').first();
			if ($primary.length) {
				$btn.insertBefore($primary);
			} else {
				$('.page-actions:visible').first().prepend($btn);
			}
		});
	}

	// Re-check on every route change
	$(document).on('page-change', function() {
		setTimeout(check_route_help, 300);
	});
	// Also check on initial load
	$(function() { setTimeout(check_route_help, 500); });

	// ------------------------------------------------------------------
	// POS crash shim (Ardmore, 2026-07-20).
	//
	// The third-party `server_script` app (Mata101/server_script) appends a
	// sales-rep <select> to the POS page title. Its injection loop indexes
	// pills by page-title position:
	//
	//   for (i = 0; i < $('div[class="page-title"]').length; i++)
	//       $('span[class="indicator-pill no-indicator-dot whitespace-nowrap blue"]')[i].style...
	//
	// When any desk page (e.g. nest-home) contributes a page-title WITHOUT a
	// pill span matching that exact class attribute, pills[i] is undefined and
	// the TypeError intermittently kills the POS Recent-Orders summary, hiding
	// the Return button. We cannot edit that app, so we make its assumption
	// true instead: every exact-match page-title gets a hidden pill span, so
	// the indexed lookup always finds an element. Cosmetic-only side effect
	// (marginRight on a hidden span). Remove once the upstream app is fixed.
	// See CoWork_Helper/gotchas/2026-07-20-frappe-pos-page-custom-script-breaks-returns.md
	// ------------------------------------------------------------------
	var PILL_CLASS = 'indicator-pill no-indicator-dot whitespace-nowrap blue';

	function pad_page_title_pills() {
		var titles = document.querySelectorAll('div[class="page-title"]');
		for (var i = 0; i < titles.length; i++) {
			if (!titles[i].querySelector('span[class="' + PILL_CLASS + '"]')) {
				var s = document.createElement('span');
				s.className = PILL_CLASS;
				s.style.display = 'none';
				s.setAttribute('data-nh-pill-shim', '1');
				titles[i].appendChild(s);
			}
		}
	}

	var _pill_timer = null;
	function schedule_pill_pad() {
		if (_pill_timer) return;
		_pill_timer = setTimeout(function() {
			_pill_timer = null;
			pad_page_title_pills();
		}, 100);
	}

	// ------------------------------------------------------------------
	// POS item-tile barcode (Ardmore, 2026-08-03).
	//
	// Every Item now carries a generated 8-digit POS barcode
	// (Item.custom_pos_barcode) and that is what the shelf sticker encodes.
	// Printing it under the tile lets a cashier confirm they picked the right
	// product, and key the number in by hand when a sticker is missing or
	// unreadable. `point-of-sale` is a standard ERPNext Page, so its JS cannot
	// be reached from a Client Script — hence this shim.
	//
	// Barcodes come from nest_home.pos_pricing.get_pos_barcodes and are cached
	// per item code (including a cached blank, so an item without a barcode is
	// never requested twice).
	// ------------------------------------------------------------------
	var POS_CODE_CLASS = 'nh-pos-code';
	var _bc_cache = {};
	var _bc_inflight = false;

	function decode_item_code(raw) {
		if (!raw) return '';
		try {
			return decodeURIComponent(raw);
		} catch (e) {
			// ERPNext writes this attribute with the legacy escape(), which
			// decodeURIComponent rejects for some byte sequences.
		}
		try {
			return unescape(raw);
		} catch (e2) {
			return raw;
		}
	}

	function ensure_pos_code_style() {
		if (document.getElementById('nh-pos-code-style')) return;
		var st = document.createElement('style');
		st.id = 'nh-pos-code-style';
		st.textContent = '.' + POS_CODE_CLASS + '{font-size:11px;letter-spacing:0.04em;'
			+ 'color:var(--text-muted,#8d99a6);margin-top:2px;'
			+ 'font-variant-numeric:tabular-nums;white-space:nowrap;}';
		document.head.appendChild(st);
	}

	function paint_pos_codes() {
		var wrappers = document.querySelectorAll('.item-wrapper[data-item-code]');
		if (!wrappers.length) return;
		ensure_pos_code_style();

		var missing = [];

		for (var i = 0; i < wrappers.length; i++) {
			var w = wrappers[i];
			var code = decode_item_code(w.getAttribute('data-item-code'));
			if (!code) continue;

			if (!(code in _bc_cache)) {
				if (missing.indexOf(code) === -1) missing.push(code);
				continue;
			}
			if (!_bc_cache[code]) continue;

			var detail = w.querySelector('.item-detail') || w;
			if (detail.querySelector('.' + POS_CODE_CLASS)) continue;

			var d = document.createElement('div');
			d.className = POS_CODE_CLASS;
			d.textContent = _bc_cache[code];
			detail.appendChild(d);
		}

		if (!missing.length || _bc_inflight) return;

		_bc_inflight = true;
		frappe.call({
			method: 'nest_home.pos_pricing.get_pos_barcodes',
			args: { item_codes: JSON.stringify(missing) },
			callback: function(r) {
				var map = (r && r.message && r.message.barcodes) || {};
				for (var j = 0; j < missing.length; j++) {
					_bc_cache[missing[j]] = map[missing[j]] || '';
				}
				_bc_inflight = false;
				paint_pos_codes();
			},
			error: function() {
				// Cache blanks so a failing call cannot become a request loop.
				for (var k = 0; k < missing.length; k++) {
					_bc_cache[missing[k]] = '';
				}
				_bc_inflight = false;
			}
		});
	}

	var _pos_timer = null;
	function schedule_pos_codes() {
		if (_pos_timer) return;
		_pos_timer = setTimeout(function() {
			_pos_timer = null;
			paint_pos_codes();
		}, 150);
	}

	$(function() {
		pad_page_title_pills();
		schedule_pos_codes();
		new MutationObserver(function() {
			schedule_pill_pad();
			schedule_pos_codes();
		}).observe(document.body, { childList: true, subtree: true });
	});

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
