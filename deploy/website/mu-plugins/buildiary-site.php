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
	return '<svg width="' . (int) $size . '" height="' . (int) $size . '" viewBox="0 0 120 120" aria-hidden="true" focusable="false"><rect width="120" height="120" rx="26" fill="#1E3A5F"/><path d="M96 .08A26 26 0 0 1 106 2.93V117.07A26 26 0 0 1 96 119.92Z" fill="#F2B01E"/><path d="M41.687999999999995 48.313Q45.574 48.313 48.735 50.343Q51.895999999999994 52.373000000000005 53.723 56.143Q55.55 59.913000000000004 55.55 64.959Q55.55 70.00500000000001 53.723 73.804Q51.895999999999994 77.60300000000001 48.735 79.63300000000001Q45.574 81.66300000000001 41.687999999999995 81.66300000000001Q38.382 81.66300000000001 35.946 80.358Q33.51 79.05300000000001 32.175999999999995 76.733V81.257H20.807999999999996V38.337H32.175999999999995V53.243Q33.51 50.923 35.946 49.618Q38.382 48.313 41.687999999999995 48.313ZM38.092 58.23100000000001Q35.598 58.23100000000001 33.887 60.02900000000001Q32.175999999999995 61.827000000000005 32.175999999999995 64.959Q32.175999999999995 68.149 33.887 69.947Q35.598 71.745 38.092 71.745Q40.586 71.745 42.297 69.918Q44.007999999999996 68.09100000000001 44.007999999999996 64.959Q44.007999999999996 61.769000000000005 42.297 60.00000000000001Q40.586 58.23100000000001 38.092 58.23100000000001Z M70.312 48.313Q73.444 48.313 75.90899999999999 49.618Q78.374 50.923 79.766 53.185V38.337H91.19200000000001V81.257H79.766V76.733Q78.432 78.995 75.99600000000001 80.32900000000001Q73.56 81.66300000000001 70.254 81.66300000000001Q66.368 81.66300000000001 63.206999999999994 79.63300000000001Q60.046 77.60300000000001 58.219 73.804Q56.392 70.00500000000001 56.392 64.959Q56.392 59.913000000000004 58.219 56.143Q60.046 52.373000000000005 63.236000000000004 50.343Q66.426 48.313 70.312 48.313ZM73.908 58.23100000000001Q71.356 58.23100000000001 69.674 60.00000000000001Q67.992 61.769000000000005 67.992 64.959Q67.992 68.09100000000001 69.674 69.918Q71.356 71.745 73.908 71.745Q76.402 71.745 78.113 69.947Q79.824 68.149 79.824 64.959Q79.824 61.827000000000005 78.113 60.02900000000001Q76.402 58.23100000000001 73.908 58.23100000000001Z" fill="#FFFFFF"/></svg>';
}

/** The name, lowercase and one colour (it takes the text colour). */
function buildiary_name_svg() {
	return '<svg class="bd-name" viewBox="0 0 451.4 106.6" role="img" aria-label="buildiary"><path d="M34.3 23.500000000000007Q41.2 23.500000000000007 46.8 27.000000000000007Q52.4 30.500000000000007 55.650000000000006 37.00000000000001Q58.900000000000006 43.50000000000001 58.900000000000006 52.10000000000001Q58.900000000000006 60.7 55.650000000000006 67.25Q52.4 73.80000000000001 46.8 77.35000000000001Q41.2 80.9 34.3 80.9Q28.400000000000002 80.9 24.0 78.55000000000001Q19.6 76.2 17.1 72.30000000000001V80.10000000000001H0.0V6.1000000000000085H17.1V32.2Q19.500000000000004 28.300000000000004 24.000000000000004 25.900000000000006Q28.500000000000004 23.500000000000007 34.3 23.500000000000007ZM29.2 38.400000000000006Q24.1 38.400000000000006 20.550000000000004 42.10000000000001Q17.000000000000004 45.800000000000004 17.000000000000004 52.2Q17.000000000000004 58.60000000000001 20.550000000000004 62.300000000000004Q24.1 66.0 29.2 66.0Q34.3 66.0 37.9 62.25Q41.5 58.50000000000001 41.5 52.10000000000001Q41.5 45.70000000000001 37.95 42.05000000000001Q34.4 38.400000000000006 29.2 38.400000000000006Z M122.0 24.300000000000004V80.10000000000001H104.9V72.50000000000001Q102.30000000000001 76.2 97.85000000000001 78.45Q93.4 80.7 88.0 80.7Q81.60000000000001 80.7 76.70000000000002 77.85000000000001Q71.80000000000001 75.00000000000001 69.10000000000001 69.60000000000001Q66.4 64.2 66.4 56.900000000000006V24.300000000000004H83.4V54.60000000000001Q83.4 60.2 86.30000000000001 63.300000000000004Q89.2 66.4 94.1 66.4Q99.10000000000001 66.4 102.0 63.300000000000004Q104.9 60.2 104.9 54.60000000000001V24.300000000000004Z M131.70000000000002 9.300000000000011Q131.70000000000002 5.300000000000011 134.55 2.6500000000000057Q137.4 0.0 141.9 0.0Q146.3 0.0 149.15 2.6500000000000057Q152.0 5.300000000000011 152.0 9.300000000000011Q152.0 13.200000000000003 149.15 15.850000000000005Q146.3 18.500000000000007 141.9 18.500000000000007Q137.4 18.500000000000007 134.55 15.850000000000005Q131.70000000000002 13.200000000000003 131.70000000000002 9.300000000000011ZM150.4 24.300000000000004V80.10000000000001H133.3V24.300000000000004Z M178.90000000000003 6.1000000000000085V80.10000000000001H161.8V6.1000000000000085Z M211.50000000000003 23.500000000000007Q217.00000000000003 23.500000000000007 221.55 25.800000000000008Q226.10000000000002 28.10000000000001 228.70000000000002 32.00000000000001V6.1000000000000085H245.8V80.10000000000001H228.70000000000002V72.10000000000001Q226.3 76.10000000000001 221.85000000000002 78.5Q217.40000000000003 80.9 211.50000000000003 80.9Q204.60000000000002 80.9 199.00000000000003 77.35000000000001Q193.40000000000003 73.80000000000001 190.15000000000003 67.25Q186.90000000000003 60.7 186.90000000000003 52.10000000000001Q186.90000000000003 43.50000000000001 190.15000000000003 37.00000000000001Q193.40000000000003 30.500000000000007 199.00000000000003 27.000000000000007Q204.60000000000002 23.500000000000007 211.50000000000003 23.500000000000007ZM216.50000000000003 38.400000000000006Q211.40000000000003 38.400000000000006 207.85000000000002 42.05000000000001Q204.3 45.70000000000001 204.3 52.10000000000001Q204.3 58.50000000000001 207.85000000000002 62.25Q211.40000000000003 66.0 216.50000000000003 66.0Q221.60000000000002 66.0 225.15000000000003 62.300000000000004Q228.70000000000002 58.60000000000001 228.70000000000002 52.2Q228.70000000000002 45.800000000000004 225.15000000000003 42.10000000000001Q221.60000000000002 38.400000000000006 216.50000000000003 38.400000000000006Z M255.60000000000002 9.300000000000011Q255.60000000000002 5.300000000000011 258.45000000000005 2.6500000000000057Q261.3 0.0 265.8 0.0Q270.20000000000005 0.0 273.05000000000007 2.6500000000000057Q275.90000000000003 5.300000000000011 275.90000000000003 9.300000000000011Q275.90000000000003 13.200000000000003 273.05000000000007 15.850000000000005Q270.20000000000005 18.500000000000007 265.8 18.500000000000007Q261.3 18.500000000000007 258.45000000000005 15.850000000000005Q255.60000000000002 13.200000000000003 255.60000000000002 9.300000000000011ZM274.3 24.300000000000004V80.10000000000001H257.20000000000005V24.300000000000004Z M306.9 23.500000000000007Q312.8 23.500000000000007 317.25 25.900000000000006Q321.7 28.300000000000004 324.1 32.2V24.300000000000004H341.2V80.10000000000001H324.1V72.2Q321.6 76.10000000000001 317.15 78.5Q312.7 80.9 306.8 80.9Q300.0 80.9 294.4 77.35000000000001Q288.8 73.80000000000001 285.55 67.25Q282.3 60.7 282.3 52.10000000000001Q282.3 43.50000000000001 285.55 37.00000000000001Q288.8 30.500000000000007 294.4 27.000000000000007Q300.0 23.500000000000007 306.9 23.500000000000007ZM311.9 38.400000000000006Q306.8 38.400000000000006 303.25 42.05000000000001Q299.7 45.70000000000001 299.7 52.10000000000001Q299.7 58.50000000000001 303.25 62.25Q306.8 66.0 311.9 66.0Q317.0 66.0 320.55 62.300000000000004Q324.1 58.60000000000001 324.1 52.2Q324.1 45.800000000000004 320.55 42.10000000000001Q317.0 38.400000000000006 311.9 38.400000000000006Z M387.2 23.700000000000003V41.800000000000004H382.5Q376.09999999999997 41.800000000000004 372.9 44.550000000000004Q369.7 47.300000000000004 369.7 54.2V80.10000000000001H352.59999999999997V24.300000000000004H369.7V33.60000000000001Q372.7 29.000000000000007 377.2 26.350000000000005Q381.7 23.700000000000003 387.2 23.700000000000003Z M451.4 24.300000000000004 416.4 106.60000000000001H398.0L410.8 78.2L388.09999999999997 24.300000000000004H407.2L420.09999999999997 59.2L432.9 24.300000000000004Z" fill="currentColor"/></svg>';
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
		. '<a class="mb-brand" href="' . esc_url(buildiary_url('')) . '">' . buildiary_logo_svg(36) . buildiary_name_svg() . '</a>'
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
		. '<div class="mb-foot-brand"><a class="mb-brand" href="' . esc_url(buildiary_url('')) . '">' . buildiary_logo_svg(32) . buildiary_name_svg() . '</a><p>' . esc_html(buildiary_t('tagline')) . '</p>' . buildiary_lang_links() . '</div>'
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
