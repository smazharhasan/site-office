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
// customers' workspaces are <name>.<this domain>
defined('BUILDIARY_WORKSPACE_DOMAIN') || define('BUILDIARY_WORKSPACE_DOMAIN', 'buildiary.app');

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

// ---- /android: the latest Android app (the address in our emails)
add_action('init', function () {
	$path = trim((string) parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH), '/');
	if ($path === 'android') {
		wp_redirect('https://github.com/smazharhasan/site-office/releases/latest/download/Buildiary.apk', 302);
		exit;
	}
});

// ---- "Start free trial" goes to the console's sign-up page in the same language
add_action('init', function () {
	$path = trim((string) parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH), '/');
	if (preg_match('#^(?:(ur|ar)/)?start-trial$#', $path, $m)) {
		$lang = $m[1] ?? 'en';
		$country = strtoupper(preg_replace('/[^A-Za-z]/', '', (string) ($_GET['country'] ?? '')));
		wp_redirect('https://' . BUILDIARY_CONSOLE . '/start?lang=' . ($lang ?: 'en') . (strlen($country) === 2 ? '&country=' . $country : ''), 302);
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
			'start' => 'Start {trial}-day free trial', 'owner' => 'Owner', 'builder' => 'Builder', 'popular' => 'For builders',
			'trial_note' => '{trial} days free, no card needed.', 'currency' => 'Currency',
			'solutions' => 'Solutions', 'company_menu' => 'Company', 'all_features' => 'See all features', 'all_guides' => 'All guides', 'mega_note' => 'One app for the owner, the builder and the site team.',
			'f_stores' => 'Stores and deliveries', 'fd_stores' => 'Receive against orders, release with a photo',
			'f_money' => 'Payments and budget', 'fd_money' => 'Bills, payments with proof, budget by phase',
			'f_build' => 'Build progress', 'fd_build' => 'Planned against built, stage by stage',
			'f_people' => 'People and site cards', 'fd_people' => 'QR site cards, face check and attendance',
			'f_water' => 'Water and petty cash', 'fd_water' => 'Tankers with TDS, tank levels, petty cash',
			'f_ask' => 'Ask the project', 'fd_ask' => 'Plain-word answers from your own records',
			's_owners' => 'Home owners', 'sd_owners' => 'Building your own house',
			's_abroad' => 'Building from abroad', 'sd_abroad' => 'Follow your site from the Gulf or anywhere',
			's_builders' => 'Builders and contractors', 'sd_builders' => 'Run several client sites in one place',
			's_team' => 'Site teams', 'sd_team' => 'Big buttons, site cards, their own language',
			'about_d' => 'Who makes Buildiary and why', 'contact_d' => 'Email or WhatsApp us', 'smh_d' => 'Our parent company',
			'region' => 'Language and currency', 'cur_note' => 'Screenshots and prices follow the currency you pick.',
			'cur_pkr' => 'Pakistani rupee', 'cur_sar' => 'Saudi riyal', 'cur_aed' => 'UAE dirham', 'cur_qar' => 'Qatari riyal', 'cur_usd' => 'US dollar',
			'signin_btn' => 'Sign in', 'ws_label' => 'Your workspace address', 'ws_go' => 'Continue', 'ws_help' => 'It is in the welcome email we sent when you started.',
			'ws_bad' => 'Use letters, numbers and dashes only.', 'ws_new' => 'New to Buildiary?', 'pay_note' => 'Pay by bank transfer: our accounts in Pakistan and the UAE, and our Saudi account from any other country.', 'close' => 'Close', 'feedback' => 'Feedback and requests',
		],
		'ur' => [
			'features' => 'خصوصیات', 'pricing' => 'قیمتیں', 'about' => 'ہمارے بارے میں', 'contact' => 'رابطہ', 'trial' => 'مفت آزمائش', 'menu' => 'مینو', 'guides' => 'رہنمائی', 'owners' => 'گھر بنوانے والوں کے لیے', 'builders' => 'بلڈرز کے لیے',
			'tagline' => 'گھر بنانے والوں اور بلڈرز کے لیے سائٹ مینجمنٹ: اسٹور، ادائیگیاں، کام کی پیش رفت اور لوگ، سب آپ کے فون پر۔',
			'product' => 'پروڈکٹ', 'company' => 'کمپنی', 'privacy' => 'رازداری کی پالیسی', 'terms' => 'شرائطِ استعمال', 'reach' => 'ہم سے بات کریں',
			'by' => 'ایس ایم ایچ گلوبل سروسز کی پیشکش', 'by_short' => 'تیار کردہ', 'maker_line' => 'ایس ایم ایچ گلوبل سروسز (پرائیویٹ) لمیٹڈ کی پیشکش', 'signin' => 'اپنے ورک اسپیس میں لاگ اِن کریں', 'langs' => 'زبان',
			'month' => 'ماہانہ', 'year' => 'سالانہ', 'per_month' => 'ماہانہ', 'per_year' => 'سالانہ', 'save' => '2 مہینے مفت',
			'projects' => '%d پروجیکٹ', 'project1' => '1 پروجیکٹ', 'users' => '%d لوگ لاگ اِن کر سکیں', 'storage' => '%d جی بی تصاویر اور فائلوں کے لیے',
			'start' => '{trial} دن کی مفت آزمائش شروع کریں', 'owner' => 'مالک', 'builder' => 'بلڈر', 'popular' => 'بلڈرز کے لیے',
			'trial_note' => '{trial} دن مفت، کارڈ کی ضرورت نہیں۔', 'currency' => 'کرنسی',
			'solutions' => 'کن کے لیے', 'company_menu' => 'کمپنی', 'all_features' => 'تمام خصوصیات دیکھیں', 'all_guides' => 'تمام رہنمائی', 'mega_note' => 'مالک، بلڈر اور سائٹ ٹیم کے لیے ایک ہی ایپ۔',
			'f_stores' => 'اسٹور اور سامان کی وصولی', 'fd_stores' => 'آرڈر کے مطابق وصولی، تصویر کے ساتھ اجرا',
			'f_money' => 'ادائیگیاں اور بجٹ', 'fd_money' => 'بل، ثبوت کے ساتھ ادائیگیاں، مرحلہ وار بجٹ',
			'f_build' => 'تعمیر کی پیش رفت', 'fd_build' => 'ہر مرحلے میں منصوبہ بمقابلہ اصل کام',
			'f_people' => 'لوگ اور سائٹ کارڈ', 'fd_people' => 'کیو آر سائٹ کارڈ، چہرے کی جانچ اور حاضری',
			'f_water' => 'پانی اور پیٹی کیش', 'fd_water' => 'ٹی ڈی ایس کے ساتھ ٹینکر، ٹینکی کی سطح، پیٹی کیش',
			'f_ask' => 'پروجیکٹ سے پوچھیں', 'fd_ask' => 'آپ کے اپنے ریکارڈ سے سیدھے جواب',
			's_owners' => 'گھر بنوانے والے', 'sd_owners' => 'اپنا گھر خود بنوا رہے ہیں',
			's_abroad' => 'بیرونِ ملک سے', 'sd_abroad' => 'خلیج یا کہیں سے بھی اپنی سائٹ دیکھیں',
			's_builders' => 'بلڈرز اور ٹھیکیدار', 'sd_builders' => 'کئی کلائنٹ سائٹس ایک جگہ',
			's_team' => 'سائٹ کی ٹیم', 'sd_team' => 'بڑے بٹن، سائٹ کارڈ، اپنی زبان',
			'about_d' => 'بلڈائری کون بناتا ہے اور کیوں', 'contact_d' => 'ای میل یا واٹس ایپ کریں', 'smh_d' => 'ہماری کمپنی',
			'region' => 'زبان اور کرنسی', 'cur_note' => 'اسکرین شاٹس اور قیمتیں آپ کی چنی ہوئی کرنسی میں دکھائی جاتی ہیں۔',
			'cur_pkr' => 'پاکستانی روپیہ', 'cur_sar' => 'سعودی ریال', 'cur_aed' => 'اماراتی درہم', 'cur_qar' => 'قطری ریال', 'cur_usd' => 'امریکی ڈالر',
			'signin_btn' => 'لاگ اِن', 'ws_label' => 'آپ کے ورک اسپیس کا پتا', 'ws_go' => 'آگے بڑھیں', 'ws_help' => 'یہ اس خوش آمدیدی ای میل میں ہے جو آغاز پر بھیجی گئی تھی۔',
			'ws_bad' => 'صرف انگریزی حروف، اعداد اور ڈیش استعمال کریں۔', 'ws_new' => 'بلڈائری پر نئے ہیں؟', 'pay_note' => 'بینک ٹرانسفر سے ادائیگی: پاکستان اور متحدہ عرب امارات میں ہمارے اکاؤنٹس، اور کسی بھی دوسرے ملک سے ہمارا سعودی اکاؤنٹ۔', 'close' => 'بند کریں', 'feedback' => 'رائے اور درخواستیں',
		],
		'ar' => [
			'features' => 'المزايا', 'pricing' => 'الأسعار', 'about' => 'من نحن', 'contact' => 'تواصل معنا', 'trial' => 'ابدأ مجاناً', 'menu' => 'القائمة', 'guides' => 'الأدلة', 'owners' => 'لمن يبني بيته', 'builders' => 'للمقاولين',
			'tagline' => 'إدارة مواقع البناء للمالك والمقاول: المخزن والدفعات وتقدّم العمل والعمّال، على جوالك.',
			'product' => 'المنتج', 'company' => 'الشركة', 'privacy' => 'سياسة الخصوصية', 'terms' => 'شروط الخدمة', 'reach' => 'تواصل معنا',
			'by' => 'منتج من SMH Global Services', 'by_short' => 'منتج من', 'maker_line' => 'منتج من SMH Global Services (Private) Limited', 'signin' => 'الدخول إلى مساحة عملك', 'langs' => 'اللغة',
			'month' => 'شهري', 'year' => 'سنوي', 'per_month' => 'شهرياً', 'per_year' => 'سنوياً', 'save' => 'شهران مجاناً',
			'projects' => '%d مشاريع', 'project1' => 'مشروع واحد', 'users' => '%d مستخدمين', 'storage' => '%d جيجابايت للصور والملفات',
			'start' => 'ابدأ تجربة مجانية لمدة {trial_days}', 'owner' => 'المالك', 'builder' => 'المقاول', 'popular' => 'للمقاولين',
			'trial_note' => '{trial_days} مجاناً، بدون بطاقة.', 'currency' => 'العملة',
			'solutions' => 'الحلول', 'company_menu' => 'الشركة', 'all_features' => 'شاهد كل المزايا', 'all_guides' => 'كل الأدلة', 'mega_note' => 'تطبيق واحد للمالك والمقاول وفريق الموقع.',
			'f_stores' => 'المخزن والتوريدات', 'fd_stores' => 'استلام مقابل الطلب، وصرف مع صورة',
			'f_money' => 'الدفعات والميزانية', 'fd_money' => 'الفواتير والدفعات بالإثبات والميزانية حسب المرحلة',
			'f_build' => 'تقدّم البناء', 'fd_build' => 'المخطط مقابل المنجز، مرحلة بمرحلة',
			'f_people' => 'العمّال وبطاقات الموقع', 'fd_people' => 'بطاقات QR وتحقق من الوجه وحضور',
			'f_water' => 'الماء والعهدة النقدية', 'fd_water' => 'الوايتات مع TDS ومنسوب الخزان والعهدة',
			'f_ask' => 'اسأل المشروع', 'fd_ask' => 'إجابات بكلمات بسيطة من سجلاتك',
			's_owners' => 'من يبني بيته', 'sd_owners' => 'تبني بيتك بنفسك',
			's_abroad' => 'البناء من الخارج', 'sd_abroad' => 'تابع موقعك من الخليج أو من أي مكان',
			's_builders' => 'المقاولون', 'sd_builders' => 'أدِر عدة مواقع لعملائك في مكان واحد',
			's_team' => 'فريق الموقع', 'sd_team' => 'أزرار كبيرة وبطاقات موقع وبلغتهم',
			'about_d' => 'من يصنع بلدائري ولماذا', 'contact_d' => 'راسلنا بالبريد أو واتساب', 'smh_d' => 'الشركة الأم',
			'region' => 'اللغة والعملة', 'cur_note' => 'تظهر الصور والأسعار بالعملة التي تختارها.',
			'cur_pkr' => 'روبية باكستانية', 'cur_sar' => 'ريال سعودي', 'cur_aed' => 'درهم إماراتي', 'cur_qar' => 'ريال قطري', 'cur_usd' => 'دولار أمريكي',
			'signin_btn' => 'تسجيل الدخول', 'ws_label' => 'عنوان مساحة عملك', 'ws_go' => 'متابعة', 'ws_help' => 'تجده في رسالة الترحيب التي أرسلناها عند البدء.',
			'ws_bad' => 'استخدم الحروف الإنجليزية والأرقام والشرطة فقط.', 'ws_new' => 'جديد على بلدائري؟', 'pay_note' => 'ادفع بالتحويل البنكي: حساباتنا في باكستان والإمارات، وحسابنا السعودي من أي بلد آخر.', 'close' => 'إغلاق', 'feedback' => 'ملاحظات وطلبات',
		],
	];
	return buildiary_trial_fill($T[buildiary_lang()][$key] ?? $T['en'][$key] ?? $key);
}

/** The free trial's length, as set in the console (Buildiary Cloud Settings). */
function buildiary_trial_days() {
	$d = function_exists('buildiary_plans') ? buildiary_plans() : [];
	return max(1, (int) ($d['trial_days'] ?? 7));
}

/** Puts the trial's length into a text: {trial} is the number, {trial_days} the number with "days" (Arabic grammar needs it). */
function buildiary_trial_fill($s) {
	if (!is_string($s) || strpos($s, '{trial') === false) {
		return $s;
	}
	$n = buildiary_trial_days();
	$lang = buildiary_lang();
	if ($lang === 'ar') {
		$days = $n === 1 ? 'يوم واحد' : ($n === 2 ? 'يومان' : ($n <= 10 ? $n . ' أيام' : $n . ' يوماً'));
	} elseif ($lang === 'ur') {
		$days = $n . ' دن';
	} else {
		$days = $n . ($n === 1 ? ' day' : ' days');
	}
	return str_replace(['{trial_days}', '{trial}'], [$days, (string) $n], $s);
}
// pages, titles and excerpts carry the placeholders; they are filled when shown
add_filter('the_content', 'buildiary_trial_fill', 20);
add_filter('the_title', 'buildiary_trial_fill', 20);
add_filter('get_the_excerpt', 'buildiary_trial_fill', 20);
add_filter('render_block', 'buildiary_trial_fill', 20);

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

const BUILDIARY_CURS = ['pkr', 'sar', 'aed', 'qar', 'usd'];

/** The money shown before the page's script picks the visitor's own (from their time zone or their choice). */
function buildiary_default_cur() {
	return ['en' => 'usd', 'ur' => 'pkr', 'ar' => 'sar'][buildiary_lang()];
}

function buildiary_flag($cur, $class = 'mb-flag') {
	return '<img class="' . esc_attr($class) . '" src="' . esc_url(get_theme_file_uri('assets/flags/' . $cur . '.svg')) . '" alt="" width="20" height="15">';
}

function buildiary_icon($k) {
	return '<i class="mb-fi mb-fi-' . esc_attr($k) . '" aria-hidden="true"></i>';
}

function buildiary_chev() {
	return '<svg class="mb-chev" width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 4.5 6 8l3.5-3.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
}

function buildiary_mega_item($href, $icon, $title, $desc = '') {
	return '<a class="mb-mega-item" href="' . esc_url($href) . '">' . buildiary_icon($icon) . '<span><b>' . esc_html($title) . '</b>' . ($desc ? '<small>' . esc_html($desc) . '</small>' : '') . '</span></a>';
}

function buildiary_dropdown($id, $label, $inner, $current = false, $small = false) {
	return '<div class="mb-dd' . ($small ? ' mb-dd-sm' : '') . '"><button type="button" class="mb-dd-btn" aria-expanded="false" aria-controls="' . esc_attr($id) . '"' . ($current ? ' data-current="true"' : '') . '>'
		. esc_html($label) . buildiary_chev() . '</button><div class="mb-mega" id="' . esc_attr($id) . '">' . $inner . '</div></div>';
}

/** The guides in this language: [address => title]. */
function buildiary_guides() {
	static $out = null;
	if ($out !== null) {
		return $out;
	}
	$out = [];
	$lang = buildiary_lang();
	$parent = get_page_by_path(($lang === 'en' ? '' : $lang . '/') . 'guides', OBJECT, 'page');
	if ($parent) {
		foreach (get_pages(['parent' => $parent->ID, 'sort_column' => 'menu_order,post_date,ID']) as $g) {
			$out[get_permalink($g)] = get_the_title($g);
		}
	}
	return $out;
}

/** Sign in: the customer types their workspace's name and goes to its sign-in page. */
function buildiary_signin_form($id) {
	return '<form class="mb-ws" data-domain="' . esc_attr(BUILDIARY_WORKSPACE_DOMAIN) . '" novalidate>'
		. '<label for="' . esc_attr($id) . '">' . esc_html(buildiary_t('ws_label')) . '</label>'
		. '<div class="mb-ws-row" dir="ltr"><input id="' . esc_attr($id) . '" name="ws" type="text" autocomplete="off" autocapitalize="none" spellcheck="false" placeholder="yourcompany" required><span>.' . esc_html(BUILDIARY_WORKSPACE_DOMAIN) . '</span></div>'
		. '<p class="mb-ws-err" role="alert" hidden>' . esc_html(buildiary_t('ws_bad')) . '</p>'
		. '<button class="mb-btn mb-btn-block" type="submit">' . esc_html(buildiary_t('ws_go')) . '</button>'
		. '<p class="mb-pop-note">' . esc_html(buildiary_t('ws_help')) . '</p>'
		. '<p class="mb-pop-note">' . esc_html(buildiary_t('ws_new')) . ' <a href="' . esc_url(buildiary_url('start-trial')) . '">' . esc_html(buildiary_t('trial')) . '</a></p></form>';
}

/** Language and currency: the languages are pages; the currency is remembered in the browser. */
function buildiary_region_panel() {
	$slug = buildiary_current_slug();
	$names = ['en' => 'English', 'ur' => 'اردو', 'ar' => 'العربية'];
	$langs = '';
	foreach ($names as $code => $name) {
		$langs .= '<a class="lang-' . $code . '" lang="' . $code . '" href="' . esc_url(buildiary_url($slug, $code)) . '"' . ($code === buildiary_lang() ? ' aria-current="true"' : '') . '>' . esc_html($name) . '</a>';
	}
	$cur0 = buildiary_default_cur();
	$curs = '';
	foreach (BUILDIARY_CURS as $c) {
		$curs .= '<button type="button" data-set-cur="' . $c . '" aria-pressed="' . ($c === $cur0 ? 'true' : 'false') . '">' . buildiary_flag($c) . '<span><b>' . strtoupper($c) . '</b><small>' . esc_html(buildiary_t('cur_' . $c)) . '</small></span></button>';
	}
	return '<p class="mb-pop-h">' . esc_html(buildiary_t('langs')) . '</p><div class="mb-rg-langs">' . $langs . '</div>'
		. '<p class="mb-pop-h">' . esc_html(buildiary_t('currency')) . '</p><div class="mb-rg-curs">' . $curs . '</div>'
		. '<p class="mb-pop-note">' . esc_html(buildiary_t('cur_note')) . '</p>';
}

add_shortcode('buildiary_header', function () {
	$here = buildiary_current_slug();
	$is = function ($s) use ($here) {
		return $here === $s || strpos($here, $s . '/') === 0;
	};
	$feat = buildiary_url('features');
	$items = '';
	foreach (['stores', 'money', 'build', 'people', 'water', 'ask'] as $k) {
		$items .= buildiary_mega_item($feat . '#' . $k, $k, buildiary_t('f_' . $k), buildiary_t('fd_' . $k));
	}
	$photo = get_theme_file_uri('assets/photos/frame-800.webp');
	$product = '<div class="mb-mega-in"><div class="mb-mega-grid">' . $items . '</div>'
		. '<div class="mb-mega-side"><img src="' . esc_url($photo) . '" alt="" width="800" height="533" loading="lazy" decoding="async"><p>' . esc_html(buildiary_t('mega_note')) . '</p>'
		. '<a class="mb-link" href="' . esc_url($feat) . '">' . esc_html(buildiary_t('all_features')) . '</a></div></div>';
	$solutions = '<div class="mb-mega-in mb-mega-list">'
		. buildiary_mega_item(buildiary_url('home-owners'), 'home', buildiary_t('s_owners'), buildiary_t('sd_owners'))
		. buildiary_mega_item(buildiary_url('home-owners'), 'lang', buildiary_t('s_abroad'), buildiary_t('sd_abroad'))
		. buildiary_mega_item(buildiary_url('builders'), 'hat', buildiary_t('s_builders'), buildiary_t('sd_builders'))
		. buildiary_mega_item($feat . '#people', 'people', buildiary_t('s_team'), buildiary_t('sd_team')) . '</div>';
	$g = '';
	foreach (buildiary_guides() as $href => $title) {
		$g .= buildiary_mega_item($href, 'book', $title);
	}
	$guides = '<div class="mb-mega-in mb-mega-list">' . $g . '<a class="mb-link" href="' . esc_url(buildiary_url('guides')) . '">' . esc_html(buildiary_t('all_guides')) . '</a></div>';
	$company = '<div class="mb-mega-in mb-mega-list">'
		. buildiary_mega_item(buildiary_url('about'), 'info', buildiary_t('about'), buildiary_t('about_d'))
		. buildiary_mega_item(buildiary_url('contact'), 'mail', buildiary_t('contact'), buildiary_t('contact_d'))
		. buildiary_mega_item('https://www.smhglobal.com.pk', 'share', 'SMH Global Services', buildiary_t('smh_d')) . '</div>';
	$nav = buildiary_dropdown('mb-dd-product', buildiary_t('product'), $product, $is('features'))
		. buildiary_dropdown('mb-dd-solutions', buildiary_t('solutions'), $solutions, $is('home-owners') || $is('builders'), true)
		. '<a class="mb-nav-link" href="' . esc_url(buildiary_url('pricing')) . '"' . ($is('pricing') ? ' aria-current="page"' : '') . '>' . esc_html(buildiary_t('pricing')) . '</a>'
		. buildiary_dropdown('mb-dd-guides', buildiary_t('guides'), $guides, $is('guides'), true)
		. buildiary_dropdown('mb-dd-company', buildiary_t('company_menu'), $company, $is('about') || $is('contact'), true);
	// on a phone the menu also holds the trial button and sign-in
	$extra = '<div class="mb-nav-extra"><a class="mb-btn mb-btn-block" href="' . esc_url(buildiary_url('start-trial')) . '">' . esc_html(buildiary_t('trial')) . '</a>'
		. '<details class="mb-nav-signin"><summary>' . esc_html(buildiary_t('signin')) . '</summary>' . buildiary_signin_form('mb-ws-m') . '</details></div>';
	$cur0 = buildiary_default_cur();
	$short = ['en' => 'EN', 'ur' => 'اردو', 'ar' => 'عربي'][buildiary_lang()];
	$region = '<div class="mb-pop-wrap mb-region"><button type="button" class="mb-region-btn" aria-expanded="false" aria-controls="mb-region-pop" title="' . esc_attr(buildiary_t('region')) . '">'
		. buildiary_flag($cur0, 'mb-flag mb-region-flag') . '<span class="mb-region-txt">' . esc_html($short) . ' · <bdi data-cur-code>' . strtoupper($cur0) . '</bdi></span>' . buildiary_chev() . '</button>'
		. '<div class="mb-pop" id="mb-region-pop" role="dialog" aria-label="' . esc_attr(buildiary_t('region')) . '">' . buildiary_region_panel() . '</div></div>';
	$signin = '<div class="mb-pop-wrap mb-signin"><button type="button" class="mb-signin-btn" aria-expanded="false" aria-controls="mb-signin-pop">' . esc_html(buildiary_t('signin_btn')) . '</button>'
		. '<div class="mb-pop" id="mb-signin-pop" role="dialog" aria-label="' . esc_attr(buildiary_t('signin')) . '"><p class="mb-pop-h">' . esc_html(buildiary_t('signin')) . '</p>' . buildiary_signin_form('mb-ws-d') . '</div></div>';
	return '<header class="mb-head"><div class="mb-wrap mb-head-in">'
		. '<a class="mb-brand" href="' . esc_url(buildiary_url('')) . '" aria-label="Buildiary">' . buildiary_logo_svg(36) . buildiary_name_svg() . '</a>'
		. '<nav class="mb-nav" id="mb-nav" aria-label="' . esc_attr(buildiary_t('menu')) . '">' . $nav . $extra . '</nav>'
		. '<div class="mb-head-end">' . $region . $signin . '<a class="mb-btn mb-btn-sm mb-head-cta" href="' . esc_url(buildiary_url('start-trial')) . '">' . esc_html(buildiary_t('trial')) . '</a>'
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
	$link = function ($href, $text) {
		return '<a href="' . esc_url($href) . '">' . esc_html($text) . '</a>';
	};
	$feat = buildiary_url('features');
	$product = '';
	foreach (['stores', 'money', 'build', 'people', 'water', 'ask'] as $k) {
		$product .= $link($feat . '#' . $k, buildiary_t('f_' . $k));
	}
	$guides = '';
	foreach (array_slice(buildiary_guides(), 0, 6, true) as $href => $title) {
		$guides .= $link($href, $title);
	}
	$wa = BUILDIARY_WHATSAPP ? '<a href="https://wa.me/' . esc_attr(preg_replace('/\D/', '', BUILDIARY_WHATSAPP)) . '" rel="noopener">WhatsApp <bdi>+' . esc_html(preg_replace('/\D/', '', BUILDIARY_WHATSAPP)) . '</bdi></a>' : '';
	$flags = '';
	foreach (['pkr', 'aed', 'sar'] as $c) {
		$flags .= buildiary_flag($c);
	}
	return '<footer class="mb-foot">'
		. '<div class="mb-wrap mb-foot-top"><div class="mb-foot-brand"><a class="mb-brand" href="' . esc_url(buildiary_url('')) . '" aria-label="Buildiary">' . buildiary_logo_svg(36) . buildiary_name_svg() . '</a><p>' . esc_html(buildiary_t('tagline')) . '</p></div>'
		. '<div class="mb-foot-cta"><a class="mb-btn" href="' . esc_url(buildiary_url('start-trial')) . '">' . esc_html(buildiary_t('trial')) . '</a><a class="mb-btn mb-btn-line" href="' . esc_url(buildiary_url('pricing')) . '">' . esc_html(buildiary_t('pricing')) . '</a></div></div>'
		. '<div class="mb-wrap mb-foot-in">'
		. '<div><h2>' . esc_html(buildiary_t('product')) . '</h2>' . $product . $link(buildiary_url('pricing'), buildiary_t('pricing')) . '</div>'
		. '<div><h2>' . esc_html(buildiary_t('solutions')) . '</h2>' . $link(buildiary_url('home-owners'), buildiary_t('s_owners')) . $link(buildiary_url('home-owners'), buildiary_t('s_abroad')) . $link(buildiary_url('builders'), buildiary_t('s_builders')) . $link($feat . '#people', buildiary_t('s_team')) . '</div>'
		. ($guides ? '<div><h2>' . esc_html(buildiary_t('guides')) . '</h2>' . $guides . $link(buildiary_url('guides'), buildiary_t('all_guides')) . '</div>' : '')
		. '<div><h2>' . esc_html(buildiary_t('company')) . '</h2>' . $link(buildiary_url('about'), buildiary_t('about')) . $link(buildiary_url('contact'), buildiary_t('contact')) . $link('https://' . BUILDIARY_CONSOLE . '/feedback?lang=' . buildiary_lang(), buildiary_t('feedback')) . $link(buildiary_url('privacy'), buildiary_t('privacy')) . $link(buildiary_url('terms'), buildiary_t('terms')) . '</div>'
		. '<div><h2>' . esc_html(buildiary_t('reach')) . '</h2><a href="mailto:' . esc_attr(BUILDIARY_SUPPORT_EMAIL) . '">' . esc_html(BUILDIARY_SUPPORT_EMAIL) . '</a>' . $wa . '<a href="https://www.smhglobal.com.pk" rel="noopener">smhglobal.com.pk</a>'
		. '<p class="mb-foot-pay"><span class="mb-foot-flags">' . $flags . '</span>' . esc_html(buildiary_t('pay_note')) . '</p></div>'
		. '</div><div class="mb-wrap mb-foot-bottom"><span>© ' . esc_html(date('Y')) . ' SMH Global Services</span>' . buildiary_lang_links() . buildiary_maker('light') . '</div></footer>';
});

// the page script goes in the page's foot, outside the content filters (which would change its "&&")
add_action('wp_footer', function () {
	if (!buildiary_is_admin_request()) {
		echo '<script>' . buildiary_page_script() . "</script>\n";
	}
}, 20);

/** Menus, sign-in, tabs, and the visitor's currency (screenshots, amounts, prices and the trial link follow it). */
function buildiary_page_script() {
	return <<<'JS'
(function(){
var D=document,R=D.documentElement,CURS=["pkr","sar","aed","qar","usd"],TZ={"Asia/Karachi":"pkr","Asia/Riyadh":"sar","Asia/Dubai":"aed","Asia/Qatar":"qar"},CC={pkr:"PK",sar:"SA",aed:"AE",qar:"QA"};
function all(q,r){return Array.prototype.slice.call((r||D).querySelectorAll(q));}
function store(k,v){try{if(v===undefined)return localStorage.getItem(k);localStorage.setItem(k,v);}catch(e){return null;}}
// menus and pop-ups: one open at a time; Escape or a click elsewhere closes it
var head=D.querySelector(".mb-head"),nav=D.getElementById("mb-nav"),menu=D.querySelector(".mb-menu");
function closeAll(except){all(".mb-dd.open,.mb-pop-wrap.open").forEach(function(x){if(x!==except){x.classList.remove("open");var b=x.querySelector("button[aria-expanded]");if(b)b.setAttribute("aria-expanded","false");}});}
function toggle(w){var o=!w.classList.contains("open");closeAll(w);w.classList.toggle("open",o);w.querySelector("button[aria-expanded]").setAttribute("aria-expanded",o?"true":"false");if(o&&w.classList.contains("mb-signin")){var i=w.querySelector("input");if(i)setTimeout(function(){i.focus();},30);}}
all(".mb-dd-btn,.mb-region-btn,.mb-signin-btn").forEach(function(b){b.addEventListener("click",function(){toggle(b.parentNode);});});
D.addEventListener("click",function(e){if(!e.target.closest(".mb-dd,.mb-pop-wrap"))closeAll();});
D.addEventListener("keydown",function(e){if(e.key==="Escape"){var o=D.querySelector(".mb-dd.open,.mb-pop-wrap.open");if(o){closeAll();var b=o.querySelector("button[aria-expanded]");if(b)b.focus();}}});
if(menu&&nav)menu.addEventListener("click",function(){var o=nav.classList.toggle("open");menu.setAttribute("aria-expanded",o?"true":"false");D.body.classList.toggle("mb-menu-open",o);});
if(head){var sc=function(){head.classList.toggle("mb-scrolled",window.scrollY>8);};window.addEventListener("scroll",sc,{passive:true});sc();}
// sign in: <name>.buildiary.app/login
all("form.mb-ws").forEach(function(f){var i=f.querySelector("input"),last=store("buildiary_ws");if(last)i.value=last;f.addEventListener("submit",function(e){e.preventDefault();var dom=f.dataset.domain,v=(i.value||"").trim().toLowerCase().replace(/^https?:\/\//,"").split("/")[0];
if(v.slice(-dom.length-1)==="."+dom)v=v.slice(0,-dom.length-1);var ok=/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/.test(v);f.querySelector(".mb-ws-err").hidden=ok;i.setAttribute("aria-invalid",ok?"false":"true");
if(ok){store("buildiary_ws",v);location.href="https://"+v+"."+dom+"/login";}});});
// tabs
all(".mb-tabs").forEach(function(t){var tabs=all("[role=tab]",t);function pick(b,focus){tabs.forEach(function(x){var on=x===b;x.setAttribute("aria-selected",on?"true":"false");x.tabIndex=on?0:-1;D.getElementById(x.getAttribute("aria-controls")).hidden=!on;});if(focus)b.focus();}
tabs.forEach(function(b,n){b.addEventListener("click",function(){pick(b);});b.addEventListener("keydown",function(e){var k=e.key,rtl=R.dir==="rtl",d=k==="ArrowRight"?(rtl?-1:1):k==="ArrowLeft"?(rtl?1:-1):0;if(k==="Home")pick(tabs[0],true);else if(k==="End")pick(tabs[tabs.length-1],true);else if(d){e.preventDefault();pick(tabs[(n+d+tabs.length)%tabs.length],true);}});});});
// the visitor's currency
function show(w){var c=w.dataset.cur,p=w.dataset.per||"month";if(!w.querySelector('.mb-price[data-cur="'+c+'"]'))c="usd";all(".mb-price",w).forEach(function(x){x.hidden=!(x.dataset.cur===c&&x.dataset.per===p);});all("button[data-per]",w).forEach(function(b){b.setAttribute("aria-pressed",b.dataset.per===p?"true":"false");});}
function set(c,keep){if(CURS.indexOf(c)<0)return;R.setAttribute("data-cur",c);if(keep)store("buildiary_cur",c);
all("img[data-shot]").forEach(function(i){var s=i.getAttribute("src"),n=s.replace(/-(pkr|sar|aed|qar|usd)-/,"-"+c+"-");if(n!==s)i.setAttribute("src",n);});
all(".mb-amt").forEach(function(a){if(a.dataset[c])a.textContent=a.dataset[c];});
all("[data-set-cur]").forEach(function(b){b.setAttribute("aria-pressed",b.dataset.setCur===c?"true":"false");});
all("[data-cur-code]").forEach(function(e){e.textContent=c.toUpperCase();});
all("img.mb-region-flag").forEach(function(i){i.src=i.src.replace(/(pkr|sar|aed|qar|usd)\.svg/,c+".svg");});
all(".mb-pricing").forEach(function(w){w.dataset.cur=c;show(w);});
all('a[href*="start-trial"]').forEach(function(a){try{var u=new URL(a.href,location.href);if(CC[c])u.searchParams.set("country",CC[c]);else u.searchParams.delete("country");a.href=u.toString();}catch(e){}});}
function guess(){var q=(location.search.match(/[?&]cur=([a-z]{3})/i)||[])[1];if(q&&CURS.indexOf(q.toLowerCase())>=0)return q.toLowerCase();var s=store("buildiary_cur");if(s&&CURS.indexOf(s)>=0)return s;try{var z=Intl.DateTimeFormat().resolvedOptions().timeZone;if(TZ[z])return TZ[z];}catch(e){}return "usd";}
D.addEventListener("click",function(e){var b=e.target.closest("[data-set-cur]");if(b)set(b.dataset.setCur,true);var p=e.target.closest(".mb-pricing button[data-per]");if(p){var w=p.closest(".mb-pricing");w.dataset.per=p.dataset.per;show(w);}});
set(guess(),false);
})();
JS;
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
		['name' => 'Owner', 'mode' => 'Owner', 'max_projects' => 2, 'max_users' => 10, 'storage_gb' => 10, 'summary' => [], 'usd' => ['month' => 15, 'year' => 150], 'PKR' => ['month' => 4200, 'year' => 42000], 'SAR' => ['month' => 55, 'year' => 560], 'AED' => ['month' => 55, 'year' => 550], 'QAR' => ['month' => 55, 'year' => 545]],
		['name' => 'Builder', 'mode' => 'Builder', 'max_projects' => 10, 'max_users' => 40, 'storage_gb' => 50, 'summary' => [], 'usd' => ['month' => 49, 'year' => 490], 'PKR' => ['month' => 13700, 'year' => 137200], 'SAR' => ['month' => 185, 'year' => 1840], 'AED' => ['month' => 180, 'year' => 1800], 'QAR' => ['month' => 180, 'year' => 1785]],
	], 'trial_days' => 7];
}

add_shortcode('buildiary_prices', function () {
	$data = buildiary_plans();
	$lang = buildiary_lang();
	$cur = buildiary_default_cur();
	$keys = ['usd' => 'usd', 'pkr' => 'PKR', 'sar' => 'SAR', 'aed' => 'AED', 'qar' => 'QAR'];
	$fmt = function ($v, $c) {
		$n = number_format((float) $v, ((float) $v == (int) $v) ? 0 : 2);
		return $c === 'usd' ? '$' . $n : strtoupper($c) . ' ' . $n;
	};
	$cards = '';
	foreach ($data['plans'] as $p) {
		$key = strtolower($p['mode']) === 'builder' ? 'builder' : 'owner';
		$prices = '';
		foreach ($keys as $c => $k) {
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
			. '<ul class="mb-checks">' . $feats . '</ul><a class="mb-btn" href="' . esc_url(buildiary_url('start-trial')) . '">' . esc_html(buildiary_t('start')) . '</a></article>';
	}
	$curs = '';
	foreach (BUILDIARY_CURS as $c) {
		$curs .= '<button type="button" data-set-cur="' . $c . '" aria-pressed="' . ($c === $cur ? 'true' : 'false') . '" title="' . esc_attr(buildiary_t('cur_' . $c)) . '">' . buildiary_flag($c) . strtoupper($c) . '</button>';
	}
	return '<div class="mb-pricing" data-cur="' . $cur . '" data-per="month">'
		. '<div class="mb-toggles"><div class="mb-seg" role="group"><button type="button" data-per="month" aria-pressed="true">' . esc_html(buildiary_t('month')) . '</button><button type="button" data-per="year" aria-pressed="false">' . esc_html(buildiary_t('year')) . ' <em>' . esc_html(buildiary_t('save')) . '</em></button></div>'
		. '<div class="mb-seg mb-seg-cur" role="group" aria-label="' . esc_attr(buildiary_t('currency')) . '">' . $curs . '</div></div>'
		. '<div class="mb-plans">' . $cards . '</div><p class="mb-note">' . esc_html(buildiary_t('trial_note')) . ' ' . esc_html(buildiary_t('pay_note')) . '</p></div>';
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
