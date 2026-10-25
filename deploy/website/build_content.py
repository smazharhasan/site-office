"""Builds the website's pages (block markup) in English, Urdu and Arabic.

    python3 build_content.py      → content/<lang>/<slug>.html and content/pages.json

The pages are WordPress blocks, so they stay editable in the WordPress editor."""

import json
import os
import re
from html import escape

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "content")
IMG = "/wp-content/themes/buildiary/assets"
LANGS = ("en", "ur", "ar")


# ---------------------------------------------------------------- blocks
def attrs(d):
	return (" " + json.dumps(d, ensure_ascii=False, separators=(",", ":"))) if d else ""


def group(inner, cls="", tag="div", full=False, wide=True, size="1200px"):
	a = {}
	if tag != "div":
		a["tagName"] = tag
	if full:
		a["align"] = "full"
	if cls:
		a["className"] = cls
	if wide:
		a["layout"] = {"type": "constrained", "contentSize": size}
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
	# the image's width and height are added when the page is shown (buildiary-seo.php), so the block
	# stays exactly as the WordPress editor writes it
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
H = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "words_home.json"), encoding="utf-8"))
PH = IMG + "/photos"
# the screenshots' currency before the page's script picks the visitor's own (by country)
DEF_CUR = {"en": "usd", "ur": "pkr", "ar": "sar"}
# an example payment in each currency (the floating card in the hero)
AMOUNT = {"pkr": "Rs 1,250,000", "sar": "SAR 16,700", "aed": "AED 17,000", "qar": "QAR 16,300", "usd": "$4,450"}


def photo(name, alt, cls="", sizes="(max-width: 760px) 100vw, 50vw", eager=False):
	"""A photo at two widths (assets/photos, downloaded by setup.sh)."""
	lazy = "" if eager else ' loading="lazy"'
	return (f'<img class="{cls}" src="{PH}/{name}-1600.webp" srcset="{PH}/{name}-800.webp 800w, {PH}/{name}-1600.webp 1600w" '
		f'sizes="{sizes}" alt="{escape(alt)}"{lazy} decoding="async">')


def shot(L, name, alt, cls="mb-phone-img", eager=False):
	"""A phone screenshot; the page's script switches it to the visitor's currency."""
	lazy = "" if eager else ' loading="lazy"'
	return (f'<img class="{cls}" data-shot="{name}" src="{IMG}/shots/{L}-{DEF_CUR[L]}-{name}.webp" width="390" height="844" '
		f'alt="{escape(alt)}"{lazy} decoding="async">')


def phone(L, name, alt, eager=False):
	return f'<div class="mb-phone">{shot(L, name, alt, eager=eager)}</div>'


def page_home(L, w):
	x = H[L]
	f = {k["ic"]: k for k in w["features"]}
	amt = " ".join(f'data-{c}="{escape(v)}"' for c, v in AMOUNT.items())
	fl = x["float"]
	hero = html(f"""<section class="mb-h2"><div class="mb-wrap mb-h2-in">
<div class="mb-h2-copy">
<p class="mb-pill"><span></span>{x["hero_eyebrow"]}</p>
<h1>{x["hero_title"]}</h1>
<p class="mb-lede">{x["hero_lede"]}</p>
<div class="mb-actions"><a class="mb-btn mb-btn-lg" href="{url(L, "start-trial")}">{w["cta_trial"]}</a><a class="mb-btn mb-btn-line" href="{url(L, "pricing")}">{w["cta_prices"]}</a></div>
<ul class="mb-ticks">{"".join(f"<li>{t}</li>" for t in x["hero_points"])}</ul>
</div>
<div class="mb-h2-visual" aria-hidden="false">
<figure class="mb-h2-photo">{photo("hero-site", w["shot_dash"], sizes="(max-width: 900px) 100vw, 560px", eager=True)}</figure>
{phone(L, "dash", w["shot_dash"], eager=True)}
<div class="mb-float mb-float-1"><i class="mb-fi mb-fi-stores"></i><div><b>{fl[0]["t"]}</b><span>{fl[0]["d"]}</span></div></div>
<div class="mb-float mb-float-2"><i class="mb-fi mb-fi-money"></i><div><b>{fl[1]["t"]}: <bdi class="mb-amt" {amt}>{AMOUNT[DEF_CUR[L]]}</bdi></b><span>{fl[1]["d"]}</span></div></div>
<div class="mb-float mb-float-3"><i class="mb-fi mb-fi-people"></i><div><b>{fl[2]["t"]}</b><span>{fl[2]["d"]}</span></div></div>
</div>
</div></section>""")
	facts = html(f"""<section class="mb-facts"><div class="mb-wrap"><ul>{"".join(f'<li><b>{k["k"]}</b><span>{k["t"]}</span></li>' for k in x["facts"])}</ul><p class="mb-origin">{x["origin"]}</p></div></section>""")
	who = html(f"""<section class="mb-section mb-who-sec"><div class="mb-wrap">
<p class="mb-eyebrow mb-center">{x["who_eyebrow"]}</p><h2 class="mb-center">{x["who_title"]}</h2>
<div class="mb-who">{"".join(f'<a class="mb-who-card" href="{url(L, c["href"])}"><figure>{photo(c["img"], c["t"], sizes="(max-width: 760px) 100vw, 300px")}</figure><div class="mb-who-body"><h3>{c["t"]}</h3><p>{c["d"]}</p><span class="mb-link">{c["a"]}</span></div></a>' for c in x["who"])}</div>
</div></section>""")
	tabs_def = [("stores", "store", "bricks"), ("money", "budget", "plans"), ("build", "build", "frame"), ("people", "dash", "rebar-team")]
	tablist = "".join(f'<button type="button" role="tab" id="tab-{k}" aria-controls="panel-{k}" aria-selected="{"true" if n == 0 else "false"}" tabindex="{0 if n == 0 else -1}"><i class="mb-fi mb-fi-{k}"></i>{x["tab_names"][k]}</button>' for n, (k, _, _) in enumerate(tabs_def))
	panels = ""
	for n, (k, sh, ph) in enumerate(tabs_def):
		ft = f[k]
		panels += (f'<div class="mb-panel" role="tabpanel" id="panel-{k}" aria-labelledby="tab-{k}"{"" if n == 0 else " hidden"}>'
			f'<div class="mb-panel-copy"><h3>{ft["t"]}</h3><p class="mb-lede">{ft["d"]}</p><ul class="mb-checks">{"".join(f"<li>{p_}</li>" for p_ in ft["points"])}</ul>'
			f'<a class="mb-link" href="{url(L, "features")}#{k}">{w["more_features"]}</a></div>'
			f'<div class="mb-panel-visual"><figure class="mb-panel-photo">{photo(ph, ft["t"], sizes="(max-width: 900px) 100vw, 560px")}</figure>{phone(L, sh, ft["t"])}</div></div>')
	tabs = html(f"""<section class="mb-section mb-alt mb-tabs-sec"><div class="mb-wrap">
<p class="mb-eyebrow mb-center">{x["tabs_eyebrow"]}</p><h2 class="mb-center">{x["tabs_title"]}</h2>
<div class="mb-tabs"><div class="mb-tablist" role="tablist">{tablist}</div>{panels}</div>
</div></section>""")
	leaks = html(f"""<section class="mb-leaks"><figure class="mb-leaks-bg">{photo("rebar", "", sizes="100vw")}</figure><div class="mb-wrap">
<p class="mb-eyebrow">{x["leaks_eyebrow"]}</p><h2>{x["leaks_title"]}</h2><p class="mb-lede">{x["leaks_lede"]}</p>
<div class="mb-leak-grid">{"".join(f'<div class="mb-leak"><p class="mb-leak-p">{k["p"]}</p><p>{k["s"]}</p></div>' for k in x["leaks"])}</div>
</div></section>""")
	tools = html(f"""<section class="mb-section"><div class="mb-wrap">
<p class="mb-eyebrow mb-center">{x["tools_eyebrow"]}</p><h2 class="mb-center">{x["tools_title"]}</h2>
<div class="mb-tools">{"".join(f'<div class="mb-tool"><i class="mb-fi mb-fi-{k["ic"]}"></i><h3>{k["t"]}</h3><p>{k["d"]}</p></div>' for k in x["tools"])}</div>
<div class="mb-center-actions"><a class="mb-btn mb-btn-line-dark" href="{url(L, "features")}">{w["more_features"]}</a></div>
</div></section>""")
	steps = group(
		p(w["steps_eyebrow"], "mb-eyebrow mb-center") + h(2, w["steps_title"], "mb-center")
		+ group("".join(box(h(3, s_["t"]) + p(s_["d"]), "mb-step") for s_ in w["steps"]), "mb-steps", wide=False),
		"mb-section mb-alt", "section", True)
	chips = "".join(f'<button type="button" data-set-cur="{c}" aria-pressed="{"true" if c == DEF_CUR[L] else "false"}"><img src="{IMG}/flags/{c}.svg" alt="" width="20" height="15">{c.upper()}</button>' for c in ("pkr", "sar", "aed", "qar", "usd"))
	gallery = html(f"""<section class="mb-section mb-cur-sec"><div class="mb-wrap">
<p class="mb-eyebrow mb-center">{x["cur_eyebrow"]}</p><h2 class="mb-center">{x["cur_title"]}</h2><p class="mb-lede mb-center">{x["cur_lede"]}</p>
<div class="mb-curchips" role="group" aria-label="{x["cur_label"]}">{chips}</div>
<div class="mb-phones2">{"".join(f'<figure>{phone(L, n, cap)}<figcaption>{cap}</figcaption></figure>' for n, cap in (("build", w["shot_build"]), ("dash", w["shot_dash"]), ("budget", w["shot_budget"])))}</div>
</div></section>""")
	prices = group(
		p(w["price_eyebrow"], "mb-eyebrow mb-center") + h(2, w["price_title"], "mb-center") + html("[buildiary_prices]"),
		"mb-section mb-alt", "section", True)
	guides = group(
		p(w["guides_eyebrow"], "mb-eyebrow mb-center") + h(2, w["guides_title"], "mb-center")
		+ guide_cards(L, [g for g in G[L]["pages"] if g["kind"] == "guide"][:3])
		+ buttons([(w["guides_all"], url(L, "guides"), True)], "mb-center-buttons"),
		"mb-section", "section", True)
	faq = group(
		h(2, w["faq_title"], "mb-center") + group("".join(details(q, a_) for q, a_ in w["faq"]), "mb-faq", wide=False),
		"mb-section mb-alt", "section", True)
	band = html(f"""<section class="mb-band"><figure class="mb-band-bg">{photo("villa-dusk", "", sizes="100vw")}</figure><div class="mb-wrap">
<h2>{x["band_title"]}</h2><p>{x["band_lede"]}</p>
<div class="mb-actions"><a class="mb-btn mb-btn-lg" href="{url(L, "start-trial")}">{w["cta_trial"]}</a><a class="mb-btn mb-btn-line" href="{url(L, "pricing")}">{w["cta_prices"]}</a></div>
</div></section>""")
	return hero + facts + who + tabs + leaks + tools + steps + gallery + prices + guides + faq + band


def cta(L, w):
	return group(h(2, w["cta_title"]) + p(w["cta_lede"]) + buttons([(w["cta_trial"], url(L, "start-trial"), False)]), "mb-cta", "section", True)


def pagehead(eyebrow, title, lede):
	return group(p(eyebrow, "mb-eyebrow") + h(1, title) + p(lede, "mb-lede"), "mb-pagehead", "section", True)


FEATURE_VISUAL = {"stores": ("store", "bricks"), "money": ("budget", "plans"), "build": ("build", "frame"), "people": ("dash", "rebar-team"),
	"water": ("store", "concrete"), "ask": ("dash", "room")}


def page_features(L, w):
	out = pagehead(w["feat_eyebrow"], w["features_title"], w["features_lede"])
	for i, x in enumerate(w["features"]):
		sh, ph = FEATURE_VISUAL.get(x["ic"], ("dash", "frame"))
		out += html(f"""<section class="mb-section mb-feat{" mb-alt" if i % 2 else ""}" id="{x["ic"]}"><div class="mb-wrap mb-feat-in{" mb-flip" if i % 2 else ""}">
<div class="mb-feat-copy"><h2 class="mb-ic mb-ic-{x["ic"]}">{x["t"]}</h2><p class="mb-lede">{x["d"]}</p><ul class="mb-checks">{"".join(f"<li>{p_}</li>" for p_ in x["points"])}</ul></div>
<div class="mb-panel-visual"><figure class="mb-panel-photo">{photo(ph, x["t"], sizes="(max-width: 900px) 100vw, 560px")}</figure>{phone(L, sh, x["t"])}</div>
</div></section>""")
	out += group(columns([h(2, w["extra_title"]) + p(w["extra_lede"], "mb-lede"), ul(w["extra_points"], "mb-checks")]), "mb-section mb-alt" if len(w["features"]) % 2 else "mb-section", "section", True)
	return out + cta(L, w)


def page_pricing(L, w):
	out = pagehead(w["price_eyebrow"], w["pricing_title"], w["pricing_lede"])
	out += group(html("[buildiary_prices]"), "mb-section", "section", True)
	out += group(columns([h(2, w["included_title"]), ul(w["included"], "mb-checks")]), "mb-section mb-alt", "section", True)
	out += group(h(2, w["faq_title"], "mb-center") + group("".join(details(q, a) for q, a in w["price_faq"]), "mb-faq", wide=False), "mb-section", "section", True)
	return out + cta(L, w)


def page_about(L, w):
	out = pagehead(w["about_eyebrow"], w["about_title"], w["about_lede"])
	out += group("".join(p(x) for x in w["about_body"]) + h(2, w["values_title"])
		+ group("".join(box(h(3, v["t"], f"mb-ic mb-ic-{v['ic']}") + p(v["d"]), "mb-card") for v in w["values"]), "mb-cards", wide=False)
		+ html("[buildiary_maker]"),
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


# ---------------------------------------------------------------- guides and solution pages
G = {L: json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), f"guides_{L}.json"), encoding="utf-8")) for L in LANGS}


def link(href, text, cls=""):
	k = f' class="{cls}"' if cls else ""
	return f'<a{k} href="{href}">{text}</a>'


def ol(items):
	li = "".join(f"<!-- wp:list-item -->\n<li>{x}</li>\n<!-- /wp:list-item -->\n" for x in items)
	return f'<!-- wp:list {{"ordered":true}} -->\n<ol class="wp-block-list">{li}</ol>\n<!-- /wp:list -->\n'


def table(head, rows):
	"""A table that becomes labelled cards on a phone (each cell carries its column's name)."""
	th = "".join(f"<th scope=\"col\">{escape(x)}</th>" for x in head)
	body = ""
	for r in rows:
		cells = ""
		for i, x in enumerate(r):
			tag = "th scope=\"row\"" if i == 0 and head[0] == "" else "td"
			label = escape(head[i]) if head[i] else ""
			cells += f'<{tag} data-label="{label}">{escape(x)}</{tag.split()[0]}>'
		body += f"<tr>{cells}</tr>"
	return html(f'<div class="mb-table"><table><thead><tr>{th}</tr></thead><tbody>{body}</tbody></table></div>')


def blocks(items):
	out = ""
	for b in items:
		kind = b[0]
		if kind in ("h2", "h3"):
			out += h(int(kind[1]), b[1])
		elif kind == "p":
			out += p(b[1])
		elif kind == "ul":
			out += ul(b[1])
		elif kind == "ol":
			out += ol(b[1])
		elif kind == "table":
			out += table(b[1], b[2])
	return out


def crumbs(L, trail):
	nav = G[L]["nav"]
	parts = [link(url(L), nav["home"])] + [link(href, text) for href, text in trail[:-1]] + [f'<span aria-current="page">{trail[-1][1]}</span>']
	return html(f'<nav class="mb-crumbs" aria-label="breadcrumb">{" <span aria-hidden=\"true\">›</span> ".join(parts)}</nav>')


def guide_cards(L, items):
	nav = G[L]["nav"]
	cards = "".join(box(h(3, link(url(L, g["slug"]), g["title"])) + p(g["excerpt"]) + p(link(url(L, g["slug"]), nav["read"]), "mb-more"), "mb-card mb-guide") for g in items)
	return group(cards, "mb-cards", wide=False)


def faq_section(L, items, alt=False):
	if not items:
		return ""
	return group(h(2, G[L]["nav"]["faq"], "mb-center") + group("".join(details(q, a) for q, a in items), "mb-faq", wide=False), "mb-section" + (" mb-alt" if alt else ""), "section", True)


def page_extra(L, w, g):
	nav = G[L]["nav"]
	guides = [x for x in G[L]["pages"] if x["kind"] == "guide"]
	if g["kind"] == "guide":
		trail = [(url(L, "guides"), nav["guides"]), (url(L, g["slug"]), g["short"])]
	else:
		trail = [(url(L, g["slug"]), g["title"] if g["kind"] == "index" else (nav["owners"] if g["slug"] == "home-owners" else nav["builders"]))]
	head = group(crumbs(L, trail) + p(g["eyebrow"], "mb-eyebrow") + h(1, g["title"]) + p(g["lede"], "mb-lede"), "mb-pagehead mb-narrow", "section", True, size="780px")
	if g["kind"] == "index":
		return head + group(guide_cards(L, guides), "mb-section", "section", True) + cta(L, w)
	body = group(blocks(g["blocks"]), "mb-section mb-article", "section", True, size="780px")
	out = head + body + faq_section(L, g.get("faq"), alt=True)
	if g["kind"] == "guide":
		others = [x for x in guides if x["slug"] != g["slug"]][:3]
		out += group(h(2, nav["related"], "mb-center") + guide_cards(L, others), "mb-section", "section", True)
	else:
		out += group(p(w["guides_eyebrow"], "mb-eyebrow mb-center") + h(2, w["guides_title"], "mb-center") + guide_cards(L, guides[:3]), "mb-section", "section", True)
	return out + cta(L, w)


PAGES = [
	("home", page_home, "home_title", "home_excerpt", ""),
	("features", page_features, "features_title", "features_excerpt", ""),
	("pricing", page_pricing, "pricing_title", "pricing_excerpt", ""),
	("about", page_about, "about_title", "about_excerpt", ""),
	("contact", page_contact, "contact_title", "contact_excerpt", ""),
	("privacy", lambda L, w: page_legal(L, w, "privacy"), "privacy_title", "privacy_excerpt", "page-plain"),
	("terms", lambda L, w: page_legal(L, w, "terms"), "terms_title", "terms_excerpt", "page-plain"),
]


def full_width(body):
	"""Sections written as HTML (not groups) span the page, like the groups marked full width."""
	return re.sub(r'<section class="(?!wp-block-group)', '<section class="alignfull ', body)


def main():
	index = []
	for L in LANGS:
		w = dict(T["en"], **T[L])
		os.makedirs(os.path.join(OUT, L, "guides"), exist_ok=True)
		for slug, fn, title_key, ex_key, template in PAGES:
			body = full_width(fn(L, w))
			with open(os.path.join(OUT, L, f"{slug}.html"), "w", encoding="utf-8") as f:
				f.write(body)
			index.append({"lang": L, "slug": slug, "title": w[title_key], "seo_title": w.get(f"{slug}_seo", ""), "excerpt": w[ex_key], "template": template, "file": f"{L}/{slug}.html"})
		for g in G[L]["pages"]:
			body = full_width(page_extra(L, w, g))
			with open(os.path.join(OUT, L, f"{g['slug']}.html"), "w", encoding="utf-8") as f:
				f.write(body)
			nav = G[L]["nav"]
			name = g.get("short") or {"home-owners": nav["owners"], "builders": nav["builders"], "guides": nav["guides"]}.get(g["slug"], g["title"])
			index.append({"lang": L, "slug": g["slug"], "title": name, "seo_title": g["seo_title"], "excerpt": g["excerpt"], "template": "", "file": f"{L}/{g['slug']}.html"})
	with open(os.path.join(OUT, "pages.json"), "w", encoding="utf-8") as f:
		json.dump(index, f, ensure_ascii=False, indent=1)
	print(len(index), "pages")


if __name__ == "__main__":
	main()
