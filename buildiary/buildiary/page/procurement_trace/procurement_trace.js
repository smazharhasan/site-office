frappe.pages["procurement-trace"].on_page_load = function (wrapper) {
	const page = frappe.ui.make_app_page({ parent: wrapper, title: __("Procurement Trace"), single_column: true });
	const $body = $(`<div class="buildiary-trace">
		<p class="text-muted">${__("Search an item, supplier, quotation, purchase order, delivery note, bill or payment number. Each purchase order is shown with everything linked to it.")}</p>
		<div class="results"></div></div>`).appendTo(page.body);
	const q = page.add_field({ fieldname: "q", fieldtype: "Data", label: __("Search"), placeholder: __("e.g. cement, PO-0003, challan 4471"),
		change() { run(q.get_value()); } });
	const link = (dt, n, lbl) => n ? frappe.utils.get_form_link(dt, n, true, frappe.utils.escape_html(lbl || n)) : "";
	const money = v => format_currency(v || 0);
	const date = d => d ? frappe.datetime.str_to_user(d) : "";
	function run(v) {
		if (!v || v.length < 2) { $body.find(".results").html(""); return; }
		frappe.call({ method: "buildiary.api.procurement_trace", args: { query: v } }).then(r => {
			const L = r.message || [];
			if (!L.length) return $body.find(".results").html(`<div class="text-muted">${__("Nothing found")}</div>`);
			$body.find(".results").html(L.map(p => `<div class="buildiary-trace-card">
				<div class="head"><b>${frappe.utils.escape_html(p.supplier_name)}</b><span class="indicator-pill ${p.status === "Completed" ? "green" : "blue"}">${__(p.status)}</span></div>
				<div class="row-t"><span>${__("Quotation")}</span><div>${p.quotations.map(x => link("Supplier Quotation", x)).join(", ") || "—"}</div></div>
				<div class="row-t"><span>${__("Purchase order")}</span><div>${link("Purchase Order", p.name)} · ${date(p.transaction_date)} · ${money(p.grand_total)}<br>${p.lines.map(i => `${frappe.utils.escape_html(i.item_name)}: ${i.received_qty}/${i.qty} ${__(i.uom)}`).join("<br>")}</div></div>
				<div class="row-t"><span>${__("Received")}</span><div>${p.receipts.map(x => `${link("Purchase Receipt", x.name)} · ${date(x.posting_date)} · ${__("DN")} ${frappe.utils.escape_html(x.supplier_delivery_note || "")} · ${frappe.utils.escape_html(x.buildiary_received_by || "")}`).join("<br>") || "—"}</div></div>
				<div class="row-t"><span>${__("Invoices")}</span><div>${p.invoices.map(x => `${link("Purchase Invoice", x.name)} · ${frappe.utils.escape_html(x.bill_no || "")} · ${date(x.posting_date)} · ${money(x.grand_total)} · ${__(x.status)}`).join("<br>") || "—"}</div></div>
				<div class="row-t"><span>${__("Payments")}</span><div>${p.payments.map(x => `${link("Payment Entry", x.name)} · ${date(x.posting_date)} · ${money(x.allocated_amount)} ${x.reference_doctype === "Purchase Order" ? "(" + __("advance") + ")" : ""}`).join("<br>") || "—"}</div></div>
			</div>`).join(""));
		});
	}
	const qs = frappe.utils.get_url_arg("q"); if (qs) { q.set_value(qs); }
};
