"""Builds the website's pages (block markup) in English, Urdu and Arabic.

    python3 build_content.py      → content/<lang>/<slug>.html and content/pages.json

The pages are WordPress blocks, so they stay editable in the WordPress editor."""

import json
import os
from html import escape

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "content")
IMG = "/wp-content/themes/mabni/assets"
LANGS = ("en", "ur", "ar")


# ---------------------------------------------------------------- blocks
def attrs(d):
	return (" " + json.dumps(d, ensure_ascii=False, separators=(",", ":"))) if d else ""


def group(inner, cls="", tag="div", full=False, wide=True):
	a = {}
	if tag != "div":
		a["tagName"] = tag
	if full:
		a["align"] = "full"
	if cls:
		a["className"] = cls
	if wide:
		a["layout"] = {"type": "constrained", "contentSize": "1160px"}
	klass = " ".join(x for x in ["wp-block-group", "alignfull" if full else "", cls] if x)
	return f'<!-- wp:group{attrs(a)} -->\n<{tag} class="{klass}">{inner}</{tag}>\n<!-- /wp:group -->\n'


def box(inner, cls):
	return f'<!-- wp:group {{"className":"{cls}"}} -->\n<div class="wp-block-group {cls}">{inner}</div>\n<!-- /wp:group -->\n'


def h(level, text, cls=""):
	a = {"level": level} if level != 2 else {}
	if cls:
		a["className"] = cls
	k = "wp-block-heading" + (" " + cls if cls else "")
	return f'<!-- wp:heading{attrs(a)} -->\n<h{level} class="{k}">{text}</h{level}>\n<!-- /wp:heading -->\n'


def p(text, cls=""):
	a = {"className": cls} if cls else {}
	k = f' class="{cls}"' if cls else ""
	return f"<!-- wp:paragraph{attrs(a)} -->\n<p{k}>{text}</p>\n<!-- /wp:paragraph -->\n"


def buttons(items, cls=""):
	out = ""
	for label, href, ghost in items:
		a = {"className": "is-style-outline mb-btn-ghost"} if ghost else {}
		k = "wp-block-button" + (" is-style-outline mb-btn-ghost" if ghost else "")
		out += f'<!-- wp:button{attrs(a)} -->\n<div class="{k}"><a class="wp-block-button__link wp-element-button" href="{href}">{label}</a></div>\n<!-- /wp:button -->\n'
	a = {"className": cls} if cls else {}
	k = "wp-block-buttons" + (" " + cls if cls else "")
	return f'<!-- wp:buttons{attrs(a)} -->\n<div class="{k}">{out}</div>\n<!-- /wp:buttons -->\n'


def ul(items, cls=""):
	li = "".join(f"<!-- wp:list-item -->\n<li>{x}</li>\n<!-- /wp:list-item -->\n" for x in items)
	a = {"className": cls} if cls else {}
	k = "wp-block-list" + (" " + cls if cls else "")
	return f'<!-- wp:list{attrs(a)} -->\n<ul class="{k}">{li}</ul>\n<!-- /wp:list -->\n'


def image(src, alt, cls="", caption=""):
	a = {"className": cls} if cls else {}
	k = "wp-block-image" + (" " + cls if cls else "")
	cap = f'<figcaption class="wp-element-caption">{caption}</figcaption>' if caption else ""
	return f'<!-- wp:image{attrs(a)} -->\n<figure class="{k}"><img src="{src}" alt="{escape(alt)}"/>{cap}</figure>\n<!-- /wp:image -->\n'


def columns(cols, cls=""):
	inner = "".join(f"<!-- wp:column -->\n<div class=\"wp-block-column\">{c}</div>\n<!-- /wp:column -->\n" for c in cols)
	a = {"className": cls} if cls else {}
	k = "wp-block-columns" + (" " + cls if cls else "")
	return f'<!-- wp:columns{attrs(a)} -->\n<div class="{k}">{inner}</div>\n<!-- /wp:columns -->\n'


def details(q, a):
	return f'<!-- wp:details -->\n<details class="wp-block-details"><summary>{q}</summary>{p(a)}</details>\n<!-- /wp:details -->\n'


def html(code):
	return f"<!-- wp:html -->\n{code}\n<!-- /wp:html -->\n"


def url(lang, slug=""):
	prefix = "" if lang == "en" else f"/{lang}"
	return f"{prefix}/{slug + '/' if slug else ''}" or "/"


# ---------------------------------------------------------------- words
T = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "words.json"), encoding="utf-8"))


def page_home(L, w):
	f = w["features"]
	hero = group(
		columns([
			p(w["hero_eyebrow"], "mb-eyebrow") + h(1, w["hero_title"]) + p(w["hero_lede"], "mb-lede")
			+ buttons([(w["cta_trial"], url(L, "start-trial"), False), (w["cta_prices"], url(L, "pricing"), True)])
			+ p(w["hero_note"], "mb-note"),
			image(f"{IMG}/{L}-dash.png", w["shot_dash"], "mb-hero-shot"),
		]),
		"mb-hero", "section", True)
	modes = group(
		p(w["modes_eyebrow"], "mb-eyebrow mb-center") + h(2, w["modes_title"], "mb-center")
		+ group(box(h(3, w["owner_t"]) + p(w["owner_d"]) + ul(w["owner_points"]), "mb-card mb-mode")
			+ box(h(3, w["builder_t"]) + p(w["builder_d"]) + ul(w["builder_points"]), "mb-card mb-mode mb-mode-b"), "mb-cards", wide=False),
		"mb-section", "section", True)
	feats = group(
		p(w["feat_eyebrow"], "mb-eyebrow mb-center") + h(2, w["feat_title"], "mb-center") + p(w["feat_lede"], "mb-lede mb-center")
		+ group("".join(box(h(3, x["t"], f"mb-ic mb-ic-{x['ic']}") + p(x["d"]), "mb-card") for x in f), "mb-cards", wide=False)
		+ buttons([(w["more_features"], url(L, "features"), True)], "mb-center-buttons"),
		"mb-section mb-alt", "section", True)
	steps = group(
		p(w["steps_eyebrow"], "mb-eyebrow mb-center") + h(2, w["steps_title"], "mb-center")
		+ group("".join(box(h(3, s["t"]) + p(s["d"]), "mb-step") for s in w["steps"]), "mb-steps", wide=False),
		"mb-section", "section", True)
	shots = group(
		p(w["shots_eyebrow"], "mb-eyebrow mb-center") + h(2, w["shots_title"], "mb-center")
		+ group(image(f"{IMG}/{L}-build.png", w["shot_build"], caption=w["shot_build"]) + image(f"{IMG}/{L}-store.png", w["shot_store"], caption=w["shot_store"])
			+ image(f"{IMG}/{L}-budget.png", w["shot_budget"], caption=w["shot_budget"]), "mb-phones", wide=False),
		"mb-section mb-alt", "section", True)
	local = group(
		columns([
			p(w["local_eyebrow"], "mb-eyebrow") + h(2, w["local_title"]) + p(w["local_lede"], "mb-lede"),
			ul(w["local_points"], "mb-checks"),
		]),
		"mb-section", "section", True)
	prices = group(
		p(w["price_eyebrow"], "mb-eyebrow mb-center") + h(2, w["price_title"], "mb-center") + html("[mabni_prices]"),
		"mb-section mb-alt", "section", True)
	faq = group(
		h(2, w["faq_title"], "mb-center") + group("".join(details(q, a) for q, a in w["faq"]), "mb-faq", wide=False),
		"mb-section", "section", True)
	return hero + modes + feats + steps + shots + local + prices + faq + cta(L, w)


def cta(L, w):
	return group(h(2, w["cta_title"]) + p(w["cta_lede"]) + buttons([(w["cta_trial"], url(L, "start-trial"), False)]), "mb-cta", "section", True)


def pagehead(eyebrow, title, lede):
	return group(p(eyebrow, "mb-eyebrow") + h(1, title) + p(lede, "mb-lede"), "mb-pagehead", "section", True)


def page_features(L, w):
	out = pagehead(w["feat_eyebrow"], w["features_title"], w["features_lede"])
	for i, x in enumerate(w["features"]):
		out += group(
			columns([
				h(2, x["t"], f"mb-ic mb-ic-{x['ic']}") + p(x["d"], "mb-lede"),
				ul(x["points"], "mb-checks"),
			]),
			"mb-section" + (" mb-alt" if i % 2 else ""), "section", True)
	out += group(columns([h(2, w["extra_title"]) + p(w["extra_lede"], "mb-lede"), ul(w["extra_points"], "mb-checks")]), "mb-section mb-alt" if len(w["features"]) % 2 else "mb-section", "section", True)
	return out + cta(L, w)


def page_pricing(L, w):
	out = pagehead(w["price_eyebrow"], w["pricing_title"], w["pricing_lede"])
	out += group(html("[mabni_prices]"), "mb-section", "section", True)
	out += group(columns([h(2, w["included_title"]), ul(w["included"], "mb-checks")]), "mb-section mb-alt", "section", True)
	out += group(h(2, w["faq_title"], "mb-center") + group("".join(details(q, a) for q, a in w["price_faq"]), "mb-faq", wide=False), "mb-section", "section", True)
	return out + cta(L, w)


def page_about(L, w):
	out = pagehead(w["about_eyebrow"], w["about_title"], w["about_lede"])
	out += group("".join(p(x) for x in w["about_body"]) + h(2, w["values_title"])
		+ group("".join(box(h(3, v["t"], f"mb-ic mb-ic-{v['ic']}") + p(v["d"]), "mb-card") for v in w["values"]), "mb-cards", wide=False),
		"mb-section", "section", True)
	return out + cta(L, w)


def page_contact(L, w):
	out = pagehead(w["contact_eyebrow"], w["contact_title"], w["contact_lede"])
	cards = box(h(3, w["c_email_t"]) + p(f'<a href="mailto:info@smhglobal.com.pk">info@smhglobal.com.pk</a>') + p(w["c_email_d"]), "mb-card")
	cards += box(h(3, w["c_trial_t"]) + p(w["c_trial_d"]) + buttons([(w["cta_trial"], url(L, "start-trial"), False)]), "mb-card")
	cards += box(h(3, w["c_company_t"]) + p(w["c_company_d"]) + p('<a href="https://www.smhglobal.com.pk">www.smhglobal.com.pk</a>'), "mb-card")
	out += group(group(cards, "mb-cards", wide=False), "mb-section mb-contact", "section", True)
	return out


def page_legal(L, w, key):
	parts = w[key]
	out = ""
	for block in parts:
		if block.startswith("## "):
			out += h(2, block[3:])
		elif block.startswith("- "):
			out += ul([x[2:] for x in block.split("\n")])
		else:
			out += p(block)
	return out


PAGES = [
	("home", page_home, "home_title", "home_excerpt", ""),
	("features", page_features, "features_title", "features_excerpt", ""),
	("pricing", page_pricing, "pricing_title", "pricing_excerpt", ""),
	("about", page_about, "about_title", "about_excerpt", ""),
	("contact", page_contact, "contact_title", "contact_excerpt", ""),
	("privacy", lambda L, w: page_legal(L, w, "privacy"), "privacy_title", "privacy_excerpt", "page-plain"),
	("terms", lambda L, w: page_legal(L, w, "terms"), "terms_title", "terms_excerpt", "page-plain"),
]


def main():
	index = []
	for L in LANGS:
		w = dict(T["en"], **T[L])
		os.makedirs(os.path.join(OUT, L), exist_ok=True)
		for slug, fn, title_key, ex_key, template in PAGES:
			body = fn(L, w)
			with open(os.path.join(OUT, L, f"{slug}.html"), "w", encoding="utf-8") as f:
				f.write(body)
			index.append({"lang": L, "slug": slug, "title": w[title_key], "excerpt": w[ex_key], "template": template, "file": f"{L}/{slug}.html"})
	with open(os.path.join(OUT, "pages.json"), "w", encoding="utf-8") as f:
		json.dump(index, f, ensure_ascii=False, indent=1)
	print(len(index), "pages")


if __name__ == "__main__":
	main()
