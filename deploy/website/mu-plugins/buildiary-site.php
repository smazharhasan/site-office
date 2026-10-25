<?php
/**
 * Plugin Name: Buildiary website
 * Description: Languages (English, Urdu, Arabic by address: /, /ur/, /ar/), the header and footer, live prices from the Buildiary console and the "Start free trial" link.
 * Version: 1.0
 */

if (!defined('ABSPATH')) {
	exit;
}

// Set in wp-config (from the server's .env): the console's address and how to reach it inside the server.
defined('BUILDIARY_CONSOLE') || define('BUILDIARY_CONSOLE', 'my.buildiary.app');
defined('BUILDIARY_CONSOLE_INTERNAL') || define('BUILDIARY_CONSOLE_INTERNAL', '');
defined('BUILDIARY_SUPPORT_EMAIL') || define('BUILDIARY_SUPPORT_EMAIL', 'info@smhglobal.com.pk');
defined('BUILDIARY_WHATSAPP') || define('BUILDIARY_WHATSAPP', '');

const BUILDIARY_LANGS = ['en', 'ur', 'ar'];

/** The page's language comes from its address: /ur/... is Urdu, /ar/... is Arabic, the rest English. */
function buildiary_lang() {
	static $lang = null;
	if ($lang !== null) {
		return $lang;
	}
	$path = trim((string) parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH), '/');
	$first = explode('/', $path)[0];
	$lang = in_array($first, ['ur', 'ar'], true) ? $first : 'en';
	return $lang;
}

function buildiary_is_admin_request() {
	return is_admin() || (defined('REST_REQUEST') && REST_REQUEST) || wp_doing_ajax() || (defined('WP_CLI') && WP_CLI);
}

/** The address of a page in a language (slug '' is the home page). */
function buildiary_url($slug, $lang = null) {
	$lang = $lang ?: buildiary_lang();
	$prefix = $lang === 'en' ? '' : $lang . '/';
	return home_url('/' . $prefix . ($slug ? trailingslashit($slug) : ''));
}

/** The page's slug without the language part, for the language switch. */
function buildiary_current_slug() {
	$path = trim((string) parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH), '/');
	$parts = $path === '' ? [] : explode('/', $path);
	if ($parts && in_array($parts[0], ['ur', 'ar'], true)) {
		array_shift($parts);
	}
	return implode('/', $parts);
}

// ---- right to left for Urdu and Arabic
add_filter('locale', function ($locale) {
	if (buildiary_is_admin_request()) {
		return $locale;
	}
	return ['en' => 'en_US', 'ur' => 'ur', 'ar' => 'ar'][buildiary_lang()];
});
add_action('init', function () {
	if (buildiary_is_admin_request()) {
		return;
	}
	global $wp_locale;
	if ($wp_locale && buildiary_lang() !== 'en') {
		$wp_locale->text_direction = 'rtl';
	}
}, 1);
add_filter('language_attributes', function ($out) {
	if (buildiary_is_admin_request()) {
		return $out;
	}
	return 'lang="' . buildiary_lang() . '" dir="' . (buildiary_lang() === 'en' ? 'ltr' : 'rtl') . '"';
});
add_filter('body_class', function ($c) {
	$c[] = 'lang-' . buildiary_lang();
	return $c;
});

// ---- "Start free trial" goes to the console's sign-up page in the same language
add_action('init', function () {
	$path = trim((string) parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH), '/');
	if (preg_match('#^(?:(ur|ar)/)?start-trial$#', $path, $m)) {
		$lang = $m[1] ?? 'en';
		wp_redirect('https://' . BUILDIARY_CONSOLE . '/start?lang=' . ($lang ?: 'en'), 302);
		exit;
	}
});

// ---- words in the header and footer
function buildiary_t($key) {
	static $T = [
		'en' => [
			'features' => 'Features', 'pricing' => 'Pricing', 'about' => 'About', 'contact' => 'Contact', 'trial' => 'Start free trial', 'menu' => 'Menu', 'guides' => 'Guides', 'owners' => 'For home owners', 'builders' => 'For builders',
			'tagline' => 'Construction site management for home owners and builders: stores, payments, progress and people, on your phone.',
			'product' => 'Product', 'company' => 'Company', 'privacy' => 'Privacy policy', 'terms' => 'Terms of service', 'reach' => 'Talk to us',
			'by' => 'A product of SMH Global Services', 'by_short' => 'A product of', 'maker_line' => 'A product of SMH Global Services (Private) Limited', 'signin' => 'Sign in to your workspace', 'langs' => 'Language',
			'month' => 'Monthly', 'year' => 'Yearly', 'per_month' => 'a month', 'per_year' => 'a year', 'save' => '2 months free',
			'projects' => '%d projects', 'project1' => '1 project', 'users' => '%d people sign in', 'storage' => '%d GB for photos and files',
			'start' => 'Start 7-day free trial', 'owner' => 'Owner', 'builder' => 'Builder', 'popular' => 'For builders',
			'trial_note' => '7 days free, no card needed. Pay by bank transfer when you are ready.', 'currency' => 'Currency',
		],
		'ur' => [
			'features' => 'خصوصیات', 'pricing' => 'قیمتیں', 'about' => 'ہمارے بارے میں', 'contact' => 'رابطہ', 'trial' => 'مفت آزمائش', 'menu' => 'مینو', 'guides' => 'رہنمائی', 'owners' => 'گھر بنوانے والوں کے لیے', 'builders' => 'بلڈرز کے لیے',
			'tagline' => 'گھر بنانے والوں اور بلڈرز کے لیے سائٹ مینجمنٹ: اسٹور، ادائیگیاں، کام کی پیش رفت اور لوگ، سب آپ کے فون پر۔',
			'product' => 'پروڈکٹ', 'company' => 'کمپنی', 'privacy' => 'رازداری کی پالیسی', 'terms' => 'شرائطِ استعمال', 'reach' => 'ہم سے بات کریں',
			'by' => 'ایس ایم ایچ گلوبل سروسز کی پیشکش', 'by_short' => 'تیار کردہ', 'maker_line' => 'ایس ایم ایچ گلوبل سروسز (پرائیویٹ) لمیٹڈ کی پیشکش', 'signin' => 'اپنے ورک اسپیس میں لاگ اِن کریں', 'langs' => 'زبان',
			'month' => 'ماہانہ', 'year' => 'سالانہ', 'per_month' => 'ماہانہ', 'per_year' => 'سالانہ', 'save' => '2 مہینے مفت',
			'projects' => '%d پروجیکٹ', 'project1' => '1 پروجیکٹ', 'users' => '%d لوگ لاگ اِن کر سکیں', 'storage' => '%d جی بی تصاویر اور فائلوں کے لیے',
			'start' => '7 دن کی مفت آزمائش شروع کریں', 'owner' => 'مالک', 'builder' => 'بلڈر', 'popular' => 'بلڈرز کے لیے',
			'trial_note' => '7 دن مفت، کارڈ کی ضرورت نہیں۔ جب تیار ہوں تو بینک ٹرانسفر سے ادائیگی کریں۔', 'currency' => 'کرنسی',
		],
		'ar' => [
			'features' => 'المزايا', 'pricing' => 'الأسعار', 'about' => 'من نحن', 'contact' => 'تواصل معنا', 'trial' => 'ابدأ مجاناً', 'menu' => 'القائمة', 'guides' => 'الأدلة', 'owners' => 'لمن يبني بيته', 'builders' => 'للمقاولين',
			'tagline' => 'إدارة مواقع البناء للمالك والمقاول: المخزن والدفعات وتقدّم العمل والعمّال، على جوالك.',
			'product' => 'المنتج', 'company' => 'الشركة', 'privacy' => 'سياسة الخصوصية', 'terms' => 'شروط الخدمة', 'reach' => 'تواصل معنا',
			'by' => 'منتج من SMH Global Services', 'by_short' => 'منتج من', 'maker_line' => 'منتج من SMH Global Services (Private) Limited', 'signin' => 'الدخول إلى مساحة عملك', 'langs' => 'اللغة',
			'month' => 'شهري', 'year' => 'سنوي', 'per_month' => 'شهرياً', 'per_year' => 'سنوياً', 'save' => 'شهران مجاناً',
			'projects' => '%d مشاريع', 'project1' => 'مشروع واحد', 'users' => '%d مستخدمين', 'storage' => '%d جيجابايت للصور والملفات',
			'start' => 'ابدأ تجربة مجانية لمدة 7 أيام', 'owner' => 'المالك', 'builder' => 'المقاول', 'popular' => 'للمقاولين',
			'trial_note' => '7 أيام مجاناً، بدون بطاقة. ادفع بالتحويل البنكي عندما تكون جاهزاً.', 'currency' => 'العملة',
		],
	];
	return $T[buildiary_lang()][$key] ?? $T['en'][$key] ?? $key;
}

function buildiary_logo_svg($size = 36) {
	return '<svg width="' . (int) $size . '" height="' . (int) $size . '" viewBox="0 0 120 120" aria-hidden="true" focusable="false"><rect width="120" height="120" rx="26" fill="#1E3A5F"/><path d="M53.5 18H45A24 24 0 0 0 21 42V78A24 24 0 0 0 45 102H53.5Z M53.5 30H44A11 11 0 0 0 33 41V52.5H53.5Z M53.5 64.5H33V79A11 11 0 0 0 44 90H53.5Z M66.5 18H75A24 24 0 0 1 99 42V78A24 24 0 0 1 75 102H66.5Z M66.5 30V90H76A11 11 0 0 0 87 79V41A11 11 0 0 0 76 30Z" fill="#FFFFFF" fill-rule="evenodd"/><rect x="53.5" y="18" width="13.0" height="84" fill="#F2B01E"/></svg>';
}

function buildiary_lang_links($class = 'mb-langs') {
	$slug = buildiary_current_slug();
	$names = ['en' => 'English', 'ur' => 'اردو', 'ar' => 'العربية'];
	$out = '<div class="' . esc_attr($class) . '" role="group" aria-label="' . esc_attr(buildiary_t('langs')) . '">';
	foreach ($names as $code => $name) {
		$cur = $code === buildiary_lang();
		$out .= '<a class="lang-' . $code . '" lang="' . $code . '" href="' . esc_url(buildiary_url($slug, $code)) . '"' . ($cur ? ' aria-current="true"' : '') . '>' . esc_html($name) . '</a>';
	}
	return $out . '</div>';
}

add_shortcode('buildiary_header', function () {
	$nav = '';
	$here = buildiary_current_slug();
	foreach (['features', 'pricing', 'guides', 'about', 'contact'] as $s) {
		$cur = ($here === $s || strpos($here, $s . '/') === 0) ? ' aria-current="page"' : '';
		$nav .= '<a href="' . esc_url(buildiary_url($s)) . '"' . $cur . '>' . esc_html(buildiary_t($s)) . '</a>';
	}
	return '<header class="mb-head"><div class="mb-wrap mb-head-in">'
		. '<a class="mb-brand" href="' . esc_url(buildiary_url('')) . '">' . buildiary_logo_svg(36) . '<span>Buil<i class="bd-d">d</i>iary</span></a>'
		. '<nav class="mb-nav" id="mb-nav" aria-label="' . esc_attr(buildiary_t('menu')) . '">' . $nav . buildiary_lang_links('mb-langs mb-langs-nav') . '</nav>'
		. '<div class="mb-head-end">' . buildiary_lang_links() . '<a class="mb-btn mb-btn-sm" href="' . esc_url(buildiary_url('start-trial')) . '">' . esc_html(buildiary_t('trial')) . '</a>'
		. '<button class="mb-menu" type="button" aria-controls="mb-nav" aria-expanded="false"><span class="screen-reader-text">' . esc_html(buildiary_t('menu')) . '</span><svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg></button>'
		. '</div></div></header>';
});

// the maker: SMH Global Services, with its logo (light on dark backgrounds)
function buildiary_maker($tone = 'dark', $label = true) {
	$img = get_theme_file_uri('assets/' . ($tone === 'light' ? 'smh-global-light.svg' : 'smh-global.svg'));
	return '<a class="mb-maker mb-maker-' . esc_attr($tone) . '" href="https://www.smhglobal.com.pk" rel="noopener">' . ($label ? '<span>' . esc_html(buildiary_t('by_short')) . '</span>' : '')
		. '<img src="' . esc_url($img) . '" alt="SMH Global Services" width="84" height="36"></a>';
}
add_shortcode('buildiary_maker', function () {
	return '<div class="mb-maker-block">' . buildiary_maker('dark', false) . '<p>' . esc_html(buildiary_t('maker_line')) . ' · <a href="https://www.smhglobal.com.pk" rel="noopener">smhglobal.com.pk</a></p></div>';
});

add_shortcode('buildiary_footer', function () {
	$link = function ($slug, $key) {
		return '<a href="' . esc_url(buildiary_url($slug)) . '">' . esc_html(buildiary_t($key)) . '</a>';
	};
	$wa = BUILDIARY_WHATSAPP ? '<a href="https://wa.me/' . esc_attr(preg_replace('/\D/', '', BUILDIARY_WHATSAPP)) . '" rel="noopener">WhatsApp +' . esc_html(preg_replace('/\D/', '', BUILDIARY_WHATSAPP)) . '</a>' : '';
	return '<footer class="mb-foot"><div class="mb-wrap mb-foot-in">'
		. '<div class="mb-foot-brand"><a class="mb-brand" href="' . esc_url(buildiary_url('')) . '">' . buildiary_logo_svg(32) . '<span>Buil<i class="bd-d">d</i>iary</span></a><p>' . esc_html(buildiary_t('tagline')) . '</p>' . buildiary_lang_links() . '</div>'
		. '<div><h2>' . esc_html(buildiary_t('product')) . '</h2>' . $link('features', 'features') . $link('pricing', 'pricing') . $link('home-owners', 'owners') . $link('builders', 'builders') . $link('start-trial', 'trial') . '</div>'
		. buildiary_footer_guides()
		. '<div><h2>' . esc_html(buildiary_t('company')) . '</h2>' . $link('about', 'about') . $link('contact', 'contact') . $link('privacy', 'privacy') . $link('terms', 'terms') . '</div>'
		. '<div><h2>' . esc_html(buildiary_t('reach')) . '</h2><a href="mailto:' . esc_attr(BUILDIARY_SUPPORT_EMAIL) . '">' . esc_html(BUILDIARY_SUPPORT_EMAIL) . '</a>' . $wa . '<a href="https://www.smhglobal.com.pk" rel="noopener">smhglobal.com.pk</a></div>'
		. '</div><div class="mb-wrap mb-foot-bottom"><span>© ' . esc_html(date('Y')) . ' SMH Global Services</span>' . buildiary_maker('light') . '</div></footer>'
		. '<script>(function(){var b=document.querySelector(".mb-menu"),n=document.getElementById("mb-nav");if(!b||!n)return;b.addEventListener("click",function(){var o=n.classList.toggle("open");b.setAttribute("aria-expanded",o?"true":"false");});})();</script>';
});

// the guides in this language, for the footer (their short names are the page titles)
function buildiary_footer_guides() {
	$lang = buildiary_lang();
	$parent = get_page_by_path(($lang === 'en' ? '' : $lang . '/') . 'guides', OBJECT, 'page');
	if (!$parent) {
		return '';
	}
	$out = '<div><h2>' . esc_html(buildiary_t('guides')) . '</h2>';
	foreach (get_pages(['parent' => $parent->ID, 'sort_column' => 'menu_order,post_date,ID']) as $g) {
		$out .= '<a href="' . esc_url(get_permalink($g)) . '">' . esc_html(get_the_title($g)) . '</a>';
	}
	return $out . '</div>';
}

// ---- prices, from the console (cached for an hour), with the last known prices as a fallback
function buildiary_plans() {
	$cached = get_transient('buildiary_plans');
	if ($cached) {
		return $cached;
	}
	$url = BUILDIARY_CONSOLE_INTERNAL ? rtrim(BUILDIARY_CONSOLE_INTERNAL, '/') : 'https://' . BUILDIARY_CONSOLE;
	$args = ['timeout' => 8, 'headers' => ['Accept' => 'application/json']];
	if (BUILDIARY_CONSOLE_INTERNAL) {
		$args['headers']['Host'] = BUILDIARY_CONSOLE;
	}
	$r = wp_remote_get($url . '/api/method/buildiary.saas.api.public_plans', $args);
	$data = null;
	if (!is_wp_error($r) && wp_remote_retrieve_response_code($r) === 200) {
		$body = json_decode(wp_remote_retrieve_body($r), true);
		$data = $body['message'] ?? null;
	}
	if ($data && !empty($data['plans'])) {
		set_transient('buildiary_plans', $data, HOUR_IN_SECONDS);
		update_option('buildiary_plans_last', $data, false);
		return $data;
	}
	return get_option('buildiary_plans_last') ?: ['plans' => [
		['name' => 'Owner', 'mode' => 'Owner', 'max_projects' => 2, 'max_users' => 10, 'storage_gb' => 10, 'summary' => [], 'usd' => ['month' => 15, 'year' => 150], 'PKR' => ['month' => 4200, 'year' => 42000], 'SAR' => ['month' => 55, 'year' => 560]],
		['name' => 'Builder', 'mode' => 'Builder', 'max_projects' => 10, 'max_users' => 40, 'storage_gb' => 50, 'summary' => [], 'usd' => ['month' => 49, 'year' => 490], 'PKR' => ['month' => 13700, 'year' => 137200], 'SAR' => ['month' => 185, 'year' => 1840]],
	], 'trial_days' => 7];
}

add_shortcode('buildiary_prices', function () {
	$data = buildiary_plans();
	$lang = buildiary_lang();
	$cur = ['en' => 'USD', 'ur' => 'PKR', 'ar' => 'SAR'][$lang];
	$fmt = function ($v, $c) {
		$n = number_format((float) $v, ((float) $v == (int) $v) ? 0 : 2);
		return $c === 'USD' ? '$' . $n : $c . ' ' . $n;
	};
	$cards = '';
	foreach ($data['plans'] as $p) {
		$key = strtolower($p['mode']) === 'builder' ? 'builder' : 'owner';
		$prices = '';
		foreach (['USD' => 'usd', 'PKR' => 'PKR', 'SAR' => 'SAR'] as $c => $k) {
			if (empty($p[$k])) {
				continue;
			}
			foreach (['month', 'year'] as $per) {
				$prices .= '<span class="mb-price" data-cur="' . $c . '" data-per="' . $per . '"' . ($c === $cur && $per === 'month' ? '' : ' hidden') . '><b>' . esc_html($fmt($p[$k][$per], $c)) . '</b> <small>' . esc_html(buildiary_t($per === 'month' ? 'per_month' : 'per_year')) . '</small></span>';
			}
		}
		$summary = $p['summary'][$lang] ?? ($p['summary']['en'] ?? '');
		$feats = '<li>' . esc_html((int) $p['max_projects'] === 1 ? buildiary_t('project1') : sprintf(buildiary_t('projects'), (int) $p['max_projects'])) . '</li>'
			. '<li>' . esc_html(sprintf(buildiary_t('users'), (int) $p['max_users'])) . '</li><li>' . esc_html(sprintf(buildiary_t('storage'), (int) $p['storage_gb'])) . '</li>';
		$cards .= '<article class="mb-plan mb-plan-' . $key . '">' . ($key === 'builder' ? '<span class="mb-plan-tag">' . esc_html(buildiary_t('popular')) . '</span>' : '')
			. '<h3>' . esc_html(buildiary_t($key)) . '</h3>' . ($summary ? '<p>' . esc_html($summary) . '</p>' : '') . '<div class="mb-prices">' . $prices . '</div>'
			. '<ul>' . $feats . '</ul><a class="mb-btn" href="' . esc_url(buildiary_url('start-trial')) . '">' . esc_html(buildiary_t('start')) . '</a></article>';
	}
	$curs = '';
	foreach (['USD', 'PKR', 'SAR'] as $c) {
		$curs .= '<button type="button" data-cur="' . $c . '" aria-pressed="' . ($c === $cur ? 'true' : 'false') . '">' . $c . '</button>';
	}
	return '<div class="mb-pricing" data-cur="' . $cur . '" data-per="month">'
		. '<div class="mb-toggles"><div class="mb-seg" role="group"><button type="button" data-per="month" aria-pressed="true">' . esc_html(buildiary_t('month')) . '</button><button type="button" data-per="year" aria-pressed="false">' . esc_html(buildiary_t('year')) . ' <em>' . esc_html(buildiary_t('save')) . '</em></button></div>'
		. '<div class="mb-seg" role="group" aria-label="' . esc_attr(buildiary_t('currency')) . '">' . $curs . '</div></div>'
		. '<div class="mb-plans">' . $cards . '</div><p class="mb-note">' . esc_html(buildiary_t('trial_note')) . '</p></div>'
		. '<script>(function(){document.querySelectorAll(".mb-pricing").forEach(function(w){function show(){w.querySelectorAll(".mb-price").forEach(function(p){p.hidden=!(p.dataset.cur===w.dataset.cur&&p.dataset.per===w.dataset.per);});w.querySelectorAll("button[data-cur]").forEach(function(b){b.setAttribute("aria-pressed",b.dataset.cur===w.dataset.cur);});w.querySelectorAll("button[data-per]").forEach(function(b){b.setAttribute("aria-pressed",b.dataset.per===w.dataset.per);});}w.addEventListener("click",function(e){var b=e.target.closest("button");if(!b)return;if(b.dataset.cur)w.dataset.cur=b.dataset.cur;if(b.dataset.per)w.dataset.per=b.dataset.per;show();});show();});})();</script>';
});

// ---- icons (the description, the other languages and the rest for search engines are in buildiary-seo.php)
add_action('wp_head', function () {
	if (buildiary_is_admin_request()) {
		return;
	}
	echo '<link rel="icon" href="' . esc_url(get_theme_file_uri('assets/buildiary-logo.svg')) . "\" type=\"image/svg+xml\" />\n";
	echo '<link rel="apple-touch-icon" href="' . esc_url(get_theme_file_uri('assets/buildiary-180.png')) . "\" />\n";
}, 1);
add_action('init', function () {
	add_post_type_support('page', 'excerpt');
	remove_post_type_support('page', 'comments');
});
add_filter('document_title_separator', function () {
	return '·';
});

// ---- quieter and safer
add_filter('xmlrpc_enabled', '__return_false');
remove_action('wp_head', 'wp_generator');
add_filter('comments_open', '__return_false', 20);
add_filter('pings_open', '__return_false', 20);
