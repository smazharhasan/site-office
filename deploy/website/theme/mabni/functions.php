<?php
/**
 * Mabni theme: fonts and the stylesheet. Languages, header, footer and prices are in the
 * mu-plugin mabni-site.php.
 */

add_action('wp_enqueue_scripts', function () {
	$lang = function_exists('mabni_lang') ? mabni_lang() : 'en';
	$families = 'family=Archivo:wdth,wght@75..110,600..800&family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@500';
	if ($lang === 'ar') {
		$families .= '&family=IBM+Plex+Sans+Arabic:wght@400;500;600;700';
	}
	if ($lang === 'ur') {
		$families .= '&family=Noto+Nastaliq+Urdu:wght@400;600;700';
	}
	wp_enqueue_style('mabni-fonts', 'https://fonts.googleapis.com/css2?' . $families . '&display=swap', [], null);
	wp_enqueue_style('mabni', get_stylesheet_uri(), ['mabni-fonts'], wp_get_theme()->get('Version'));
});

add_action('wp_head', function () {
	echo '<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>' . "\n";
	echo '<meta name="theme-color" content="#1E3A5F">' . "\n";
}, 2);

add_action('after_setup_theme', function () {
	add_theme_support('wp-block-styles');
	add_theme_support('editor-styles');
	add_editor_style('style.css');
	remove_theme_support('core-block-patterns');
});
