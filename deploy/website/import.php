<?php
/**
 * Creates or updates the website's pages from content/pages.json (run with WP-CLI):
 *
 *     wp eval-file import.php [content folder] [force]
 *
 * A page someone has edited in WordPress is left alone (unless --force), so the site's
 * owner can change the wording without an update overwriting it.
 */

if (!defined('WP_CLI')) {
	exit("Run with WP-CLI\n");
}

$dir = isset($args[0]) && $args[0] !== 'force' ? rtrim($args[0], '/') : __DIR__ . '/content';
$force = in_array('force', $args ?? [], true);
$pages = json_decode(file_get_contents("$dir/pages.json"), true);
if (!$pages) {
	WP_CLI::error("No pages in $dir/pages.json");
}

function mabni_upsert($path, $parent, $slug, $title, $content, $excerpt, $template, $force) {
	$page = get_page_by_path($path, OBJECT, 'page');
	$hash = md5($content . '|' . $title . '|' . $excerpt);
	$data = [
		'post_type' => 'page', 'post_status' => 'publish', 'post_title' => $title, 'post_name' => $slug,
		'post_parent' => $parent, 'post_content' => $content, 'post_excerpt' => $excerpt, 'comment_status' => 'closed', 'ping_status' => 'closed',
	];
	if ($page) {
		$last = get_post_meta($page->ID, '_mabni_hash', true);
		$current = md5($page->post_content . '|' . $page->post_title . '|' . $page->post_excerpt);
		if (!$force && $last && $current !== $last) {
			WP_CLI::log("kept (edited in WordPress): /$path/");
			return $page->ID;
		}
		if ($current === $hash) {
			return $page->ID;
		}
		$data['ID'] = $page->ID;
		$id = wp_update_post(wp_slash($data), true);
		WP_CLI::log("updated: /$path/");
	} else {
		$id = wp_insert_post(wp_slash($data), true);
		WP_CLI::log("created: /$path/");
	}
	if (is_wp_error($id)) {
		WP_CLI::error($id->get_error_message());
	}
	update_post_meta($id, '_mabni_hash', $hash);
	update_post_meta($id, '_wp_page_template', $template ?: 'default');
	return $id;
}

$homes = [];
// language home pages first (the other pages sit under them)
foreach ($pages as $p) {
	if ($p['slug'] !== 'home') {
		continue;
	}
	$slug = $p['lang'] === 'en' ? 'home' : $p['lang'];
	$homes[$p['lang']] = mabni_upsert($slug, 0, $slug, $p['title'], file_get_contents("$dir/{$p['file']}"), $p['excerpt'], $p['template'], $force);
}
foreach ($pages as $p) {
	if ($p['slug'] === 'home') {
		continue;
	}
	$parent = $p['lang'] === 'en' ? 0 : $homes[$p['lang']];
	$path = $p['lang'] === 'en' ? $p['slug'] : "{$p['lang']}/{$p['slug']}";
	mabni_upsert($path, $parent, $p['slug'], $p['title'], file_get_contents("$dir/{$p['file']}"), $p['excerpt'], $p['template'], $force);
}

// the English home page is the site's front page
update_option('show_on_front', 'page');
update_option('page_on_front', $homes['en']);
update_option('permalink_structure', '/%postname%/');
update_option('default_comment_status', 'closed');
update_option('default_ping_status', 'closed');
flush_rewrite_rules(false);

// WordPress's sample content
foreach (['sample-page', 'privacy-policy'] as $s) {
	$old = get_page_by_path($s);
	if ($old && !get_post_meta($old->ID, '_mabni_hash', true)) {
		wp_delete_post($old->ID, true);
	}
}
$hello = get_page_by_path('hello-world', OBJECT, 'post');
if ($hello) {
	wp_delete_post($hello->ID, true);
}
WP_CLI::success(count($pages) . ' pages in place');
