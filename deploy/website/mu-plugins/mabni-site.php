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
defined('MABNI_CONSOLE') || define('MABNI_CONSOLE', 'my.buildiary.app');
defined('MABNI_CONSOLE_INTERNAL') || define('MABNI_CONSOLE_INTERNAL', '');
defined('MABNI_SUPPORT_EMAIL') || define('MABNI_SUPPORT_EMAIL', 'info@smhglobal.com.pk');
defined('MABNI_WHATSAPP') || define('MABNI_WHATSAPP', '');

const MABNI_LANGS = ['en', 'ur', 'ar'];

/** The page's language comes from its address: /ur/... is Urdu, /ar/... is Arabic, the rest English. */
function mabni_lang() {
	static $lang = null;
	if ($lang !== null) {
		return $lang;
	}
	$path = trim((string) parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH), '/');
	$first = explode('/', $path)[0];
	$lang = in_array($first, ['ur', 'ar'], true) ? $first : 'en';
	return $lang;
}

function mabni_is_admin_request() {
	return is_admin() || (defined('REST_REQUEST') && REST_REQUEST) || wp_doing_ajax() || (defined('WP_CLI') && WP_CLI);
}

/** The address of a page in a language (slug '' is the home page). */
function mabni_url($slug, $lang = null) {
	$lang = $lang ?: mabni_lang();
	$prefix = $lang === 'en' ? '' : $lang . '/';
	return home_url('/' . $prefix . ($slug ? trailingslashit($slug) : ''));
}

/** The page's slug without the language part, for the language switch. */
function mabni_current_slug() {
	$path = trim((string) parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH), '/');
	$parts = $path === '' ? [] : explode('/', $path);
	if ($parts && in_array($parts[0], ['ur', 'ar'], true)) {
		array_shift($parts);
	}
	return implode('/', $parts);
}

// ---- right to left for Urdu and Arabic
add_filter('locale', function ($locale) {
	if (mabni_is_admin_request()) {
		return $locale;
	}
	return ['en' => 'en_US', 'ur' => 'ur', 'ar' => 'ar'][mabni_lang()];
});
add_action('init', function () {
	if (mabni_is_admin_request()) {
		return;
	}
	global $wp_locale;
	if ($wp_locale && mabni_lang() !== 'en') {
		$wp_locale->text_direction = 'rtl';
	}
}, 1);
add_filter('language_attributes', function ($out) {
	if (mabni_is_admin_request()) {
		return $out;
	}
	return 'lang="' . mabni_lang() . '" dir="' . (mabni_lang() === 'en' ? 'ltr' : 'rtl') . '"';
});
add_filter('body_class', function ($c) {
	$c[] = 'lang-' . mabni_lang();
	return $c;
});

// ---- "Start free trial" goes to the console's sign-up page in the same language
add_action('init', function () {
	$path = trim((string) parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH), '/');
	if (preg_match('#^(?:(ur|ar)/)?start-trial$#', $path, $m)) {
		$lang = $m[1] ?? 'en';
		wp_redirect('https://' . MABNI_CONSOLE . '/start?lang=' . ($lang ?: 'en'), 302);
		exit;
	}
});

// ---- words in the header and footer
function mabni_t($key) {
	static $T = [
		'en' => [
			'features' => 'Features', 'pricing' => 'Pricing', 'about' => 'About', 'contact' => 'Contact', 'trial' => 'Start free trial', 'menu' => 'Menu',
			'tagline' => 'Construction site management for home owners and builders: stores, payments, progress and people, on your phone.',
			'product' => 'Product', 'company' => 'Company', 'privacy' => 'Privacy policy', 'terms' => 'Terms of service', 'reach' => 'Talk to us',
			'by' => 'A product of SMH Global Services', 'signin' => 'Sign in to your workspace', 'langs' => 'Language',
			'month' => 'Monthly', 'year' => 'Yearly', 'per_month' => 'a month', 'per_year' => 'a year', 'save' => '2 months free',
			'projects' => '%d projects', 'project1' => '1 project', 'users' => '%d people sign in', 'storage' => '%d GB for photos and files',
			'start' => 'Start 7-day free trial', 'owner' => 'Owner', 'builder' => 'Builder', 'popular' => 'For builders',
			'trial_note' => '7 days free, no card needed. Pay by bank transfer when you are ready.', 'currency' => 'Currency',
		],
		'ur' => [
			'features' => 'خصوصیات', 'pricing' => 'قیمتیں', 'about' => 'ہمارے بارے میں', 'contact' => 'رابطہ', 'trial' => 'مفت آزمائش', 'menu' => 'مینو',
			'tagline' => 'گھر بنانے والوں اور بلڈرز کے لیے سائٹ مینجمنٹ: اسٹور، ادائیگیاں، کام کی پیش رفت اور لوگ، سب آپ کے فون پر۔',
			'product' => 'پروڈکٹ', 'company' => 'کمپنی', 'privacy' => 'رازداری کی پالیسی', 'terms' => 'شرائطِ استعمال', 'reach' => 'ہم سے بات کریں',
			'by' => 'ایس ایم ایچ گلوبل سروسز کی پیشکش', 'signin' => 'اپنے ورک اسپیس میں لاگ اِن کریں', 'langs' => 'زبان',
			'month' => 'ماہانہ', 'year' => 'سالانہ', 'per_month' => 'ماہانہ', 'per_year' => 'سالانہ', 'save' => '2 مہینے مفت',
			'projects' => '%d پروجیکٹ', 'project1' => '1 پروجیکٹ', 'users' => '%d لوگ لاگ اِن کر سکیں', 'storage' => '%d جی بی تصاویر اور فائلوں کے لیے',
			'start' => '7 دن کی مفت آزمائش شروع کریں', 'owner' => 'مالک', 'builder' => 'بلڈر', 'popular' => 'بلڈرز کے لیے',
			'trial_note' => '7 دن مفت، کارڈ کی ضرورت نہیں۔ جب تیار ہوں تو بینک ٹرانسفر سے ادائیگی کریں۔', 'currency' => 'کرنسی',
		],
		'ar' => [
			'features' => 'المزايا', 'pricing' => 'الأسعار', 'about' => 'من نحن', 'contact' => 'تواصل معنا', 'trial' => 'ابدأ مجاناً', 'menu' => 'القائمة',
			'tagline' => 'إدارة مواقع البناء للمالك والمقاول: المخزن والدفعات وتقدّم العمل والعمّال، على جوالك.',
			'product' => 'المنتج', 'company' => 'الشركة', 'privacy' => 'سياسة الخصوصية', 'terms' => 'شروط الخدمة', 'reach' => 'تواصل معنا',
			'by' => 'منتج من SMH Global Services', 'signin' => 'الدخول إلى مساحة عملك', 'langs' => 'اللغة',
			'month' => 'شهري', 'year' => 'سنوي', 'per_month' => 'شهرياً', 'per_year' => 'سنوياً', 'save' => 'شهران مجاناً',
			'projects' => '%d مشاريع', 'project1' => 'مشروع واحد', 'users' => '%d مستخدمين', 'storage' => '%d جيجابايت للصور والملفات',
			'start' => 'ابدأ تجربة مجانية لمدة 7 أيام', 'owner' => 'المالك', 'builder' => 'المقاول', 'popular' => 'للمقاولين',
			'trial_note' => '7 أيام مجاناً، بدون بطاقة. ادفع بالتحويل البنكي عندما تكون جاهزاً.', 'currency' => 'العملة',
		],
	];
	return $T[mabni_lang()][$key] ?? $T['en'][$key] ?? $key;
}

function mabni_logo_svg($size = 36) {
	return '<svg width="' . (int) $size . '" height="' . (int) $size . '" viewBox="0 0 120 120" aria-hidden="true" focusable="false"><rect width="120" height="120" rx="26" fill="#1E3A5F"/><path d="M0 24H120M0 48H120M0 72H120M0 96H120M24 0V120M48 0V120M72 0V120M96 0V120" stroke="#FFFFFF" stroke-opacity=".10" stroke-width="1"/><g transform="translate(5 -3)"><g fill="none" stroke="#FFFFFF" stroke-width="6" stroke-linejoin="miter"><path d="M34 22H70L80 32V44L72 51L82 58V80L72 90H34Z"/><path d="M45 33H66L69 36V42L66 45H45Z"/><path d="M45 57H68L71 60V76L68 79H45Z"/></g><g stroke="#F2B01E" stroke-width="3.5" fill="none"><path d="M34 102H82"/><path d="M34 96V108M82 96V108M58 98V106"/></g><g fill="#F2B01E"><rect x="24" y="30" width="12" height="5" rx="2.5"/><rect x="24" y="53" width="12" height="5" rx="2.5"/><rect x="24" y="76" width="12" height="5" rx="2.5"/></g></g></svg>';
}

function mabni_lang_links($class = 'mb-langs') {
	$slug = mabni_current_slug();
	$names = ['en' => 'English', 'ur' => 'اردو', 'ar' => 'العربية'];
	$out = '<div class="' . esc_attr($class) . '" role="group" aria-label="' . esc_attr(mabni_t('langs')) . '">';
	foreach ($names as $code => $name) {
		$cur = $code === mabni_lang();
		$out .= '<a class="lang-' . $code . '" lang="' . $code . '" href="' . esc_url(mabni_url($slug, $code)) . '"' . ($cur ? ' aria-current="true"' : '') . '>' . esc_html($name) . '</a>';
	}
	return $out . '</div>';
}

add_shortcode('mabni_header', function () {
	$nav = '';
	foreach (['features', 'pricing', 'about', 'contact'] as $s) {
		$cur = mabni_current_slug() === $s ? ' aria-current="page"' : '';
		$nav .= '<a href="' . esc_url(mabni_url($s)) . '"' . $cur . '>' . esc_html(mabni_t($s)) . '</a>';
	}
	return '<header class="mb-head"><div class="mb-wrap mb-head-in">'
		. '<a class="mb-brand" href="' . esc_url(mabni_url('')) . '">' . mabni_logo_svg(36) . '<span>Buildiary</span></a>'
		. '<nav class="mb-nav" id="mb-nav" aria-label="' . esc_attr(mabni_t('menu')) . '">' . $nav . mabni_lang_links('mb-langs mb-langs-nav') . '</nav>'
		. '<div class="mb-head-end">' . mabni_lang_links() . '<a class="mb-btn mb-btn-sm" href="' . esc_url(mabni_url('start-trial')) . '">' . esc_html(mabni_t('trial')) . '</a>'
		. '<button class="mb-menu" type="button" aria-controls="mb-nav" aria-expanded="false"><span class="screen-reader-text">' . esc_html(mabni_t('menu')) . '</span><svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg></button>'
		. '</div></div></header>';
});

add_shortcode('mabni_footer', function () {
	$link = function ($slug, $key) {
		return '<a href="' . esc_url(mabni_url($slug)) . '">' . esc_html(mabni_t($key)) . '</a>';
	};
	$wa = MABNI_WHATSAPP ? '<a href="https://wa.me/' . esc_attr(preg_replace('/\D/', '', MABNI_WHATSAPP)) . '" rel="noopener">WhatsApp +' . esc_html(preg_replace('/\D/', '', MABNI_WHATSAPP)) . '</a>' : '';
	return '<footer class="mb-foot"><div class="mb-wrap mb-foot-in">'
		. '<div class="mb-foot-brand"><a class="mb-brand" href="' . esc_url(mabni_url('')) . '">' . mabni_logo_svg(32) . '<span>Buildiary</span></a><p>' . esc_html(mabni_t('tagline')) . '</p>' . mabni_lang_links() . '</div>'
		. '<div><h2>' . esc_html(mabni_t('product')) . '</h2>' . $link('features', 'features') . $link('pricing', 'pricing') . $link('start-trial', 'trial') . '</div>'
		. '<div><h2>' . esc_html(mabni_t('company')) . '</h2>' . $link('about', 'about') . $link('contact', 'contact') . $link('privacy', 'privacy') . $link('terms', 'terms') . '</div>'
		. '<div><h2>' . esc_html(mabni_t('reach')) . '</h2><a href="mailto:' . esc_attr(MABNI_SUPPORT_EMAIL) . '">' . esc_html(MABNI_SUPPORT_EMAIL) . '</a>' . $wa . '<a href="https://www.smhglobal.com.pk" rel="noopener">smhglobal.com.pk</a></div>'
		. '</div><div class="mb-wrap mb-foot-bottom"><span>© ' . esc_html(date('Y')) . ' SMH Global Services</span><span>' . esc_html(mabni_t('by')) . '</span></div></footer>'
		. '<script>(function(){var b=document.querySelector(".mb-menu"),n=document.getElementById("mb-nav");if(!b||!n)return;b.addEventListener("click",function(){var o=n.classList.toggle("open");b.setAttribute("aria-expanded",o?"true":"false");});})();</script>';
});

// ---- prices, from the console (cached for an hour), with the last known prices as a fallback
function mabni_plans() {
	$cached = get_transient('mabni_plans');
	if ($cached) {
		return $cached;
	}
	$url = MABNI_CONSOLE_INTERNAL ? rtrim(MABNI_CONSOLE_INTERNAL, '/') : 'https://' . MABNI_CONSOLE;
	$args = ['timeout' => 8, 'headers' => ['Accept' => 'application/json']];
	if (MABNI_CONSOLE_INTERNAL) {
		$args['headers']['Host'] = MABNI_CONSOLE;
	}
	$r = wp_remote_get($url . '/api/method/mimaar.saas.api.public_plans', $args);
	$data = null;
	if (!is_wp_error($r) && wp_remote_retrieve_response_code($r) === 200) {
		$body = json_decode(wp_remote_retrieve_body($r), true);
		$data = $body['message'] ?? null;
	}
	if ($data && !empty($data['plans'])) {
		set_transient('mabni_plans', $data, HOUR_IN_SECONDS);
		update_option('mabni_plans_last', $data, false);
		return $data;
	}
	return get_option('mabni_plans_last') ?: ['plans' => [
		['name' => 'Owner', 'mode' => 'Owner', 'max_projects' => 2, 'max_users' => 10, 'storage_gb' => 10, 'summary' => [], 'usd' => ['month' => 15, 'year' => 150], 'PKR' => ['month' => 4200, 'year' => 42000], 'SAR' => ['month' => 55, 'year' => 560]],
		['name' => 'Builder', 'mode' => 'Builder', 'max_projects' => 10, 'max_users' => 40, 'storage_gb' => 50, 'summary' => [], 'usd' => ['month' => 49, 'year' => 490], 'PKR' => ['month' => 13700, 'year' => 137200], 'SAR' => ['month' => 185, 'year' => 1840]],
	], 'trial_days' => 7];
}

add_shortcode('mabni_prices', function () {
	$data = mabni_plans();
	$lang = mabni_lang();
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
				$prices .= '<span class="mb-price" data-cur="' . $c . '" data-per="' . $per . '"' . ($c === $cur && $per === 'month' ? '' : ' hidden') . '><b>' . esc_html($fmt($p[$k][$per], $c)) . '</b> <small>' . esc_html(mabni_t($per === 'month' ? 'per_month' : 'per_year')) . '</small></span>';
			}
		}
		$summary = $p['summary'][$lang] ?? ($p['summary']['en'] ?? '');
		$feats = '<li>' . esc_html((int) $p['max_projects'] === 1 ? mabni_t('project1') : sprintf(mabni_t('projects'), (int) $p['max_projects'])) . '</li>'
			. '<li>' . esc_html(sprintf(mabni_t('users'), (int) $p['max_users'])) . '</li><li>' . esc_html(sprintf(mabni_t('storage'), (int) $p['storage_gb'])) . '</li>';
		$cards .= '<article class="mb-plan mb-plan-' . $key . '">' . ($key === 'builder' ? '<span class="mb-plan-tag">' . esc_html(mabni_t('popular')) . '</span>' : '')
			. '<h3>' . esc_html(mabni_t($key)) . '</h3>' . ($summary ? '<p>' . esc_html($summary) . '</p>' : '') . '<div class="mb-prices">' . $prices . '</div>'
			. '<ul>' . $feats . '</ul><a class="mb-btn" href="' . esc_url(mabni_url('start-trial')) . '">' . esc_html(mabni_t('start')) . '</a></article>';
	}
	$curs = '';
	foreach (['USD', 'PKR', 'SAR'] as $c) {
		$curs .= '<button type="button" data-cur="' . $c . '" aria-pressed="' . ($c === $cur ? 'true' : 'false') . '">' . $c . '</button>';
	}
	return '<div class="mb-pricing" data-cur="' . $cur . '" data-per="month">'
		. '<div class="mb-toggles"><div class="mb-seg" role="group"><button type="button" data-per="month" aria-pressed="true">' . esc_html(mabni_t('month')) . '</button><button type="button" data-per="year" aria-pressed="false">' . esc_html(mabni_t('year')) . ' <em>' . esc_html(mabni_t('save')) . '</em></button></div>'
		. '<div class="mb-seg" role="group" aria-label="' . esc_attr(mabni_t('currency')) . '">' . $curs . '</div></div>'
		. '<div class="mb-plans">' . $cards . '</div><p class="mb-note">' . esc_html(mabni_t('trial_note')) . '</p></div>'
		. '<script>(function(){document.querySelectorAll(".mb-pricing").forEach(function(w){function show(){w.querySelectorAll(".mb-price").forEach(function(p){p.hidden=!(p.dataset.cur===w.dataset.cur&&p.dataset.per===w.dataset.per);});w.querySelectorAll("button[data-cur]").forEach(function(b){b.setAttribute("aria-pressed",b.dataset.cur===w.dataset.cur);});w.querySelectorAll("button[data-per]").forEach(function(b){b.setAttribute("aria-pressed",b.dataset.per===w.dataset.per);});}w.addEventListener("click",function(e){var b=e.target.closest("button");if(!b)return;if(b.dataset.cur)w.dataset.cur=b.dataset.cur;if(b.dataset.per)w.dataset.per=b.dataset.per;show();});show();});})();</script>';
});

// ---- search engines: the other languages of this page, and a description
add_action('wp_head', function () {
	if (mabni_is_admin_request()) {
		return;
	}
	$slug = mabni_current_slug();
	foreach (MABNI_LANGS as $l) {
		echo '<link rel="alternate" hreflang="' . esc_attr($l) . '" href="' . esc_url(mabni_url($slug, $l)) . "\" />\n";
	}
	echo '<link rel="alternate" hreflang="x-default" href="' . esc_url(mabni_url($slug, 'en')) . "\" />\n";
	if (is_singular()) {
		$ex = get_the_excerpt();
		if ($ex) {
			echo '<meta name="description" content="' . esc_attr(wp_strip_all_tags($ex)) . "\" />\n";
		}
	}
	echo '<link rel="icon" href="' . esc_url(get_theme_file_uri('assets/mabni-logo.svg')) . "\" type=\"image/svg+xml\" />\n";
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
