<?php
/**
 * Plugin Name: Buildiary search
 * Description: What search engines and AI assistants read: page titles and descriptions, the other languages of each page, social cards, structured data (company, product and prices, questions, breadcrumbs, guides), robots.txt, the sitemap, /llms.txt and IndexNow.
 * Version: 1.0
 */

if (!defined('ABSPATH')) {
	exit;
}

function buildiary_seo_front() {
	return !(is_admin() || wp_doing_ajax() || (defined('REST_REQUEST') && REST_REQUEST) || (defined('WP_CLI') && WP_CLI));
}

function buildiary_seo_lang() {
	return function_exists('buildiary_lang') ? buildiary_lang() : 'en';
}

/** The page being shown, or null (404, search). */
function buildiary_seo_page() {
	if (!is_singular()) {
		return null;
	}
	$p = get_queried_object();
	return $p instanceof WP_Post ? $p : null;
}

function buildiary_seo_title($post) {
	$t = get_post_meta($post->ID, '_buildiary_seo_title', true);
	return buildiary_seo_fill($t ?: wp_strip_all_tags(get_the_title($post)) . ' · Buildiary');
}

function buildiary_seo_description($post) {
	return buildiary_seo_fill(wp_strip_all_tags($post->post_excerpt ?: wp_trim_words(strip_shortcodes($post->post_content), 30, '…')));
}

/** The trial's length from the console (buildiary-site.php), in titles and descriptions. */
function buildiary_seo_fill($s) {
	return function_exists('buildiary_trial_fill') ? buildiary_trial_fill($s) : $s;
}

function buildiary_seo_asset($file) {
	return get_theme_file_uri('assets/' . $file);
}

// ---- the title in the browser tab and in search results
add_filter('pre_get_document_title', function ($title) {
	if (!buildiary_seo_front()) {
		return $title;
	}
	$p = buildiary_seo_page();
	return $p ? buildiary_seo_title($p) : $title;
}, 20);

// ---- page images: width and height for the screenshots (no jump while loading; WordPress then
//      loads the first one early and the rest only when scrolled to)
add_filter('render_block_core/image', function ($html) {
	if (strpos($html, '/themes/buildiary/assets/') === false || strpos($html, ' width=') !== false) {
		return $html;
	}
	return preg_replace('#<img (?=[^>]*/themes/buildiary/assets/(?:en|ur|ar)-[a-z]+\.(?:webp|png))#', '<img width="780" height="1688" ', $html, 1);
});

// ---- head: description, the other languages, social cards and structured data
add_action('wp_head', function () {
	if (!buildiary_seo_front()) {
		return;
	}
	$lang = buildiary_seo_lang();
	$post = buildiary_seo_page();
	$slug = function_exists('buildiary_current_slug') ? buildiary_current_slug() : '';
	if (is_404() || !$post) {
		return;
	}
	$title = buildiary_seo_title($post);
	$desc = buildiary_seo_description($post);
	$url = wp_get_canonical_url($post) ?: get_permalink($post);
	if ($desc) {
		echo '<meta name="description" content="' . esc_attr($desc) . "\" />\n";
	}
	// the same page in English, Urdu and Arabic
	foreach (['en', 'ur', 'ar'] as $l) {
		echo '<link rel="alternate" hreflang="' . $l . '" href="' . esc_url(buildiary_url($slug, $l)) . "\" />\n";
	}
	echo '<link rel="alternate" hreflang="x-default" href="' . esc_url(buildiary_url($slug, 'en')) . "\" />\n";

	// social cards (WhatsApp, LinkedIn, Facebook, X)
	$locales = ['en' => 'en_US', 'ur' => 'ur_PK', 'ar' => 'ar_SA'];
	$img = buildiary_seo_asset('og-' . $lang . '.png');
	$is_guide = strpos($slug, 'guides/') === 0;
	$meta = [
		['property', 'og:type', $is_guide ? 'article' : 'website'],
		['property', 'og:site_name', 'Buildiary'],
		['property', 'og:title', $title],
		['property', 'og:description', $desc],
		['property', 'og:url', $url],
		['property', 'og:image', $img],
		['property', 'og:image:width', '1200'],
		['property', 'og:image:height', '630'],
		['property', 'og:image:alt', 'Buildiary'],
		['property', 'og:locale', $locales[$lang]],
		['name', 'twitter:card', 'summary_large_image'],
		['name', 'twitter:title', $title],
		['name', 'twitter:description', $desc],
		['name', 'twitter:image', $img],
	];
	foreach ($locales as $l => $loc) {
		if ($l !== $lang) {
			$meta[] = ['property', 'og:locale:alternate', $loc];
		}
	}
	foreach ($meta as [$attr, $key, $value]) {
		echo '<meta ' . $attr . '="' . esc_attr($key) . '" content="' . esc_attr($value) . "\" />\n";
	}
	echo '<script type="application/ld+json">' . wp_json_encode(buildiary_seo_graph($post, $slug, $lang, $title, $desc, $url), JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE) . "</script>\n";
}, 1);

/** Structured data for this page: the company, the website, the product, the page, its questions. */
function buildiary_seo_graph($post, $slug, $lang, $title, $desc, $url) {
	$home = home_url('/');
	$org = [
		'@type' => 'Organization',
		'@id' => $home . '#org',
		'name' => 'SMH Global Services',
		'legalName' => 'SMH Global Services (Private) Limited',
		'url' => 'https://www.smhglobal.com.pk',
		'logo' => ['@type' => 'ImageObject', 'url' => buildiary_seo_asset('smh-global.png')],
		'email' => defined('BUILDIARY_SUPPORT_EMAIL') ? BUILDIARY_SUPPORT_EMAIL : 'info@smhglobal.com.pk',
		'brand' => ['@type' => 'Brand', 'name' => 'Buildiary', 'logo' => buildiary_seo_asset('buildiary-512.png')],
	];
	$site = [
		'@type' => 'WebSite',
		'@id' => $home . '#website',
		'url' => $home,
		'name' => 'Buildiary',
		'alternateName' => ['بلڈائری', 'بلدائري'],
		'inLanguage' => ['en', 'ur', 'ar'],
		'publisher' => ['@id' => $home . '#org'],
	];
	$graph = [$org, $site, buildiary_seo_app($lang)];

	$types = ['about' => 'AboutPage', 'contact' => 'ContactPage', 'guides' => 'CollectionPage'];
	$page = [
		'@type' => $types[$slug] ?? 'WebPage',
		'@id' => $url . '#page',
		'url' => $url,
		'name' => $title,
		'description' => $desc,
		'inLanguage' => $lang,
		'isPartOf' => ['@id' => $home . '#website'],
		'about' => ['@id' => $home . '#app'],
		'primaryImageOfPage' => buildiary_seo_asset('og-' . $lang . '.png'),
		'dateModified' => get_post_modified_time('c', true, $post),
	];
	$crumbs = buildiary_seo_crumbs($slug, $lang);
	if ($crumbs) {
		$page['breadcrumb'] = ['@id' => $url . '#crumbs'];
		$graph[] = ['@type' => 'BreadcrumbList', '@id' => $url . '#crumbs', 'itemListElement' => $crumbs];
	}
	$graph[] = $page;

	if (strpos($slug, 'guides/') === 0) {
		$graph[] = [
			'@type' => 'Article',
			'@id' => $url . '#article',
			'headline' => wp_strip_all_tags(buildiary_seo_h1($post) ?: get_the_title($post)),
			'description' => $desc,
			'inLanguage' => $lang,
			'mainEntityOfPage' => ['@id' => $url . '#page'],
			'image' => buildiary_seo_asset('og-' . $lang . '.png'),
			'datePublished' => get_post_time('c', true, $post),
			'dateModified' => get_post_modified_time('c', true, $post),
			'author' => ['@id' => $home . '#org'],
			'publisher' => ['@id' => $home . '#org'],
		];
	}
	$faq = buildiary_seo_faq($post->post_content);
	if ($faq) {
		$graph[] = ['@type' => 'FAQPage', '@id' => $url . '#faq', 'url' => $url, 'inLanguage' => $lang, 'isPartOf' => ['@id' => $home . '#website'], 'mainEntity' => $faq];
	}
	return ['@context' => 'https://schema.org', '@graph' => $graph];
}

/** The product, with its current prices from the console. */
function buildiary_seo_app($lang) {
	$home = home_url('/');
	$text = [
		'en' => 'Construction site management app for home owners and builders: deliveries, the site store, payments, budget, build progress, inspections and the site team, on the phone. English, Urdu and Arabic. {trial}-day free trial.',
		'ur' => 'گھر بنوانے والوں اور بلڈرز کے لیے کنسٹرکشن سائٹ مینجمنٹ ایپ: مال کی آمد، سائٹ اسٹور، ادائیگیاں، بجٹ، کام کی پیش رفت، معائنے اور سائٹ کی ٹیم، فون پر۔ اردو، انگریزی اور عربی۔ {trial} دن مفت۔',
		'ar' => 'تطبيق لإدارة مواقع البناء للمالك والمقاول: التوريدات ومخزن الموقع والدفعات والميزانية وتقدّم العمل والفحوصات وفريق الموقع، على الجوال. بالعربية والإنجليزية والأردية. تجربة مجانية لمدة {trial_days}.',
	];
	$features = [
		'Stores and deliveries received against purchase orders, with photos',
		'Supplier quotations, purchase orders, bills and payments with proof',
		'Budget by phase, commitments and monthly cash-flow forecast',
		'Build progress by stage with dated photos; inspections, snags and site diary',
		'Site cards, face check and attendance',
		'Water tankers, tank levels and petty cash',
		'Ask questions about the project in plain language',
		'Owner mode and Builder mode (one store per site)',
		'English, Urdu and Arabic',
	];
	$offers = [];
	$pricing = function_exists('buildiary_url') ? buildiary_url('pricing', $lang) : home_url('/pricing/');
	$data = function_exists('buildiary_plans') ? buildiary_plans() : ['plans' => []];
	foreach ($data['plans'] ?? [] as $plan) {
		foreach (['usd' => 'USD', 'PKR' => 'PKR', 'SAR' => 'SAR', 'AED' => 'AED', 'QAR' => 'QAR'] as $k => $cur) {
			foreach (['month' => 'P1M', 'year' => 'P1Y'] as $per => $dur) {
				if (!isset($plan[$k][$per])) {
					continue;
				}
				$offers[] = [
					'@type' => 'Offer',
					'name' => $plan['name'] . ' plan, ' . ($per === 'month' ? 'monthly' : 'yearly'),
					'price' => (string) $plan[$k][$per],
					'priceCurrency' => $cur,
					'priceSpecification' => ['@type' => 'UnitPriceSpecification', 'price' => (string) $plan[$k][$per], 'priceCurrency' => $cur, 'billingDuration' => $dur, 'unitText' => $per === 'month' ? 'MONTH' : 'YEAR'],
					'availability' => 'https://schema.org/InStock',
					'url' => $pricing,
				];
			}
		}
	}
	$app = [
		'@type' => 'SoftwareApplication',
		'@id' => $home . '#app',
		'name' => 'Buildiary',
		'alternateName' => ['بلڈائری', 'بلدائري'],
		'description' => buildiary_seo_fill($text[$lang]),
		'url' => $home,
		'applicationCategory' => 'BusinessApplication',
		'applicationSubCategory' => 'Construction management software',
		'operatingSystem' => 'Web browser, Android',
		'inLanguage' => ['en', 'ur', 'ar'],
		'image' => buildiary_seo_asset('buildiary-512.png'),
		'screenshot' => [buildiary_seo_asset($lang . '-dash.webp'), buildiary_seo_asset($lang . '-build.webp'), buildiary_seo_asset($lang . '-store.webp'), buildiary_seo_asset($lang . '-budget.webp')],
		'featureList' => $features,
		'publisher' => ['@id' => $home . '#org'],
		'countriesSupported' => ['PK', 'SA', 'AE', 'QA', 'OM', 'BH', 'KW'],
	];
	if ($offers) {
		$app['offers'] = $offers;
	}
	return $app;
}

/** The page's place in the site, from its address. */
function buildiary_seo_crumbs($slug, $lang) {
	if ($slug === '') {
		return [];
	}
	$names = ['en' => 'Home', 'ur' => 'ہوم', 'ar' => 'الرئيسية'];
	$items = [['@type' => 'ListItem', 'position' => 1, 'name' => $names[$lang], 'item' => buildiary_url('', $lang)]];
	$path = '';
	foreach (explode('/', $slug) as $i => $part) {
		$path = ltrim($path . '/' . $part, '/');
		$full = ($lang === 'en' ? '' : $lang . '/') . $path;
		$page = get_page_by_path($full, OBJECT, 'page');
		$items[] = ['@type' => 'ListItem', 'position' => $i + 2, 'name' => $page ? wp_strip_all_tags(get_the_title($page)) : $part, 'item' => buildiary_url($path, $lang)];
	}
	return $items;
}

function buildiary_seo_h1($post) {
	return preg_match('#<h1[^>]*>(.*?)</h1>#s', $post->post_content, $m) ? $m[1] : '';
}

/** The questions and answers shown on the page (the <details> blocks). */
function buildiary_seo_faq($content) {
	if (!preg_match_all('#<summary>(.*?)</summary>\s*(?:<!--[^>]*-->\s*)?<p[^>]*>(.*?)</p>#s', $content, $m, PREG_SET_ORDER)) {
		return [];
	}
	$out = [];
	foreach ($m as $qa) {
		$out[] = ['@type' => 'Question', 'name' => buildiary_seo_fill(wp_strip_all_tags($qa[1])), 'acceptedAnswer' => ['@type' => 'Answer', 'text' => buildiary_seo_fill(wp_strip_all_tags($qa[2]))]];
	}
	return $out;
}

// ---- robots.txt: everything public may be read, by search engines and AI assistants alike
add_filter('robots_txt', function ($out, $public) {
	if (!$public) {
		return $out;
	}
	$rules = "Disallow: /wp-admin/\nAllow: /wp-admin/admin-ajax.php\nDisallow: /start-trial/\nDisallow: /ur/start-trial/\nDisallow: /ar/start-trial/\nDisallow: /?s=\n";
	$ai = ['Googlebot', 'Bingbot', 'OAI-SearchBot', 'ChatGPT-User', 'GPTBot', 'Claude-SearchBot', 'Claude-User', 'ClaudeBot', 'PerplexityBot', 'Perplexity-User', 'Google-Extended', 'Applebot', 'Applebot-Extended', 'DuckAssistBot', 'Meta-WebIndexer', 'MistralAI-User'];
	$txt = "# Buildiary: construction site management for home owners and builders.\n# Search engines and AI assistants are welcome to read, index and cite this website.\n\nUser-agent: *\n" . $rules . "\n";
	foreach ($ai as $bot) {
		$txt .= "User-agent: $bot\n";
	}
	$txt .= "Allow: /\n" . $rules . "\nSitemap: " . home_url('/wp-sitemap.xml') . "\n";
	return $txt;
}, 20, 2);

// ---- sitemap: pages only (no user names, no empty categories), with the date each last changed
add_filter('wp_sitemaps_add_provider', function ($provider, $name) {
	return $name === 'users' ? false : $provider;
}, 10, 2);
add_filter('wp_sitemaps_taxonomies', '__return_empty_array');
add_filter('wp_sitemaps_post_types', function ($types) {
	return array_intersect_key($types, ['page' => 1, 'post' => 1]);
});
add_filter('wp_sitemaps_posts_entry', function ($entry, $post) {
	$entry['lastmod'] = get_post_modified_time('c', true, $post);
	return $entry;
}, 10, 2);

// ---- no author pages or user lists (they would show the admin's user name)
add_action('template_redirect', function () {
	if (is_author() || (isset($_GET['author']) && !is_admin())) {
		wp_safe_redirect(home_url('/'), 301);
		exit;
	}
});
add_filter('rest_endpoints', function ($endpoints) {
	if (!is_user_logged_in()) {
		foreach (array_keys($endpoints) as $route) {
			if (strpos($route, '/wp/v2/users') === 0) {
				unset($endpoints[$route]);
			}
		}
	}
	return $endpoints;
});

// ---- a lighter head: no emoji script, feeds of an empty blog, or links nobody uses
remove_action('wp_head', 'print_emoji_detection_script', 7);
remove_action('wp_print_styles', 'print_emoji_styles');
remove_action('wp_head', 'feed_links', 2);
remove_action('wp_head', 'feed_links_extra', 3);
remove_action('wp_head', 'rsd_link');
remove_action('wp_head', 'wlwmanifest_link');
remove_action('wp_head', 'wp_shortlink_wp_head');
remove_action('wp_head', 'rest_output_link_wp_head');
remove_action('wp_head', 'wp_oembed_add_discovery_links');
remove_action('template_redirect', 'rest_output_link_header', 11);
add_filter('emoji_svg_url', '__return_false');

// ---- /llms.txt: a plain summary of the site for AI assistants, built from the live pages
add_action('init', function () {
	$path = trim((string) parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH), '/');
	if ($path === 'llms.txt') {
		header('Content-Type: text/plain; charset=utf-8');
		header('Cache-Control: public, max-age=3600');
		echo buildiary_llms_txt();
		exit;
	}
	$key = get_option('buildiary_indexnow_key');
	if ($key && $path === $key . '.txt') {
		header('Content-Type: text/plain; charset=utf-8');
		echo $key;
		exit;
	}
}, 0);

function buildiary_llms_txt() {
	$page = function ($path) {
		$p = get_page_by_path($path, OBJECT, 'page');
		if (!$p || $p->post_status !== 'publish') {
			return '';
		}
		return '- [' . wp_strip_all_tags(get_the_title($p)) . '](' . get_permalink($p) . '): ' . wp_strip_all_tags($p->post_excerpt) . "\n";
	};
	$out = "# Buildiary\n\n> Buildiary is a construction site management app for people building their own home and for builders and contractors running client sites, mainly in Pakistan, Saudi Arabia and the Gulf. It records deliveries, the site store, payments, the budget, build progress, inspections and the site team on the phone, in English, Urdu and Arabic. It is made by SMH Global Services (Private) Limited (https://www.smhglobal.com.pk). Every new workspace is free for {trial} days; plans are paid monthly or yearly in USD, PKR, SAR, AED or QAR.\n\n";
	$out .= "## Key facts\n\n- Two modes: Owner (someone building their own house) and Builder (a contractor running several client sites, each with its own store).\n- Works in any phone or computer browser; an Android app is available for site staff.\n- Languages: English, Urdu and Arabic, chosen per person; Urdu and Arabic read right to left.\n- Built on ERPNext (open-source accounting and stock), with double-entry accounts behind every payment.\n- Each customer workspace is a separate database with daily backups.\n";
	$data = function_exists('buildiary_plans') ? buildiary_plans() : ['plans' => []];
	foreach ($data['plans'] ?? [] as $p) {
		if (!empty($p['usd'])) {
			$out .= '- ' . $p['name'] . ' plan: up to ' . (int) $p['max_projects'] . ' projects and ' . (int) $p['max_users'] . ' users; USD ' . $p['usd']['month'] . ' a month or USD ' . $p['usd']['year'] . ' a year'
				. (!empty($p['PKR']) ? ' (PKR ' . number_format((float) $p['PKR']['month']) . ' a month)' : '') . (!empty($p['SAR']) ? ' (SAR ' . $p['SAR']['month'] . ' a month)' : '') . ".\n";
		}
	}
	$out .= "\n## Product\n\n" . $page('home') . $page('features') . $page('pricing') . $page('home-owners') . $page('builders');
	$out .= "\n## Guides\n\n" . $page('guides');
	$guides = get_page_by_path('guides', OBJECT, 'page');
	if ($guides) {
		foreach (get_pages(['parent' => $guides->ID, 'sort_column' => 'menu_order,post_date']) as $g) {
			$out .= $page('guides/' . $g->post_name);
		}
	}
	$out .= "\n## Company\n\n" . $page('about') . $page('contact') . $page('privacy') . $page('terms');
	$out .= "\n## Other languages\n\n- [Urdu website](" . home_url('/ur/') . "): the same pages in Urdu.\n- [Arabic website](" . home_url('/ar/') . "): the same pages in Arabic.\n";
	return buildiary_seo_fill($out);
}

// ---- IndexNow: tells Bing and the other IndexNow search engines straight away when a page changes
function buildiary_indexnow_key() {
	$key = get_option('buildiary_indexnow_key');
	if (!$key) {
		$key = strtolower(wp_generate_password(32, false, false));
		update_option('buildiary_indexnow_key', $key, false);
	}
	return $key;
}

/** Sends these addresses to IndexNow; only when the site is open to search engines. */
function buildiary_indexnow($urls) {
	$urls = array_values(array_unique(array_filter($urls)));
	if (!$urls || !get_option('blog_public')) {
		return 'skipped';
	}
	$host = parse_url(home_url('/'), PHP_URL_HOST);
	if (filter_var($host, FILTER_VALIDATE_IP) || preg_match('/(sslip|nip)\.io$|localhost|\.local$|\.test$/', $host)) {
		return 'skipped (temporary address)';
	}
	$key = buildiary_indexnow_key();
	$r = wp_remote_post('https://api.indexnow.org/indexnow', [
		'timeout' => 15,
		'headers' => ['Content-Type' => 'application/json; charset=utf-8'],
		'body' => wp_json_encode(['host' => $host, 'key' => $key, 'keyLocation' => home_url('/' . $key . '.txt'), 'urlList' => $urls]),
	]);
	return is_wp_error($r) ? 'error: ' . $r->get_error_message() : 'HTTP ' . wp_remote_retrieve_response_code($r) . ' for ' . count($urls) . ' pages';
}

function buildiary_indexnow_all() {
	$ids = get_posts(['post_type' => 'page', 'post_status' => 'publish', 'numberposts' => -1, 'fields' => 'ids']);
	return buildiary_indexnow(array_map('get_permalink', $ids));
}

// pages edited in WordPress are announced too (the update script announces its own changes)
add_action('transition_post_status', function ($new, $old, $post) {
	if ($new === 'publish' && $post->post_type === 'page' && !(defined('WP_CLI') && WP_CLI)) {
		buildiary_indexnow([get_permalink($post)]);
	}
}, 10, 3);
