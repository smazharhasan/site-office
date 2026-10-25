frappe.ui.form.on("Supplier", {
	refresh(frm) {
		if (frm.is_new()) return;
		const go = (share, how) => frappe.call({ method: "buildiary.api.supplier_statement_pdf", args: { supplier: frm.doc.name, share: share ? 1 : 0 }, freeze: true }).then((r) => {
			const m = r.message || {};
			if (how === "pdf") window.open(m.file_url); else if (how === "wa") buildiary.open_whatsapp(m); else buildiary.email_link(m, __("Account statement"));
		});
		frm.add_custom_button(__("View"), () => frappe.set_route("query-report", "Supplier Account Statement", { supplier: frm.doc.name }), __("Account statement"));
		frm.add_custom_button(__("PDF"), () => go(false, "pdf"), __("Account statement"));
		frm.add_custom_button(__("WhatsApp"), () => go(true, "wa"), __("Account statement"));
		frm.add_custom_button(__("Email"), () => go(true, "mail"), __("Account statement"));
		frm.add_custom_button(__("Scan a quotation"), () => { buildiary._scan_next = true; frappe.new_doc("Supplier Quotation", { supplier: frm.doc.name }); }, __("Create"));
		frappe.call({ method: "buildiary.api.supplier_statement", args: { supplier: frm.doc.name } }).then((r) => {
			const s = r.message; if (!s) return;
			const due = s.balance >= 0 ? __("Due {0}", [`<b>${buildiary.money(s.due)}</b>`]) : __("Advance with supplier {0}", [`<b>${buildiary.money(s.advance)}</b>`]);
			frm.dashboard.set_headline([__("Ordered {0}", [buildiary.money(s.ordered)]), __("Received {0}", [buildiary.money(s.received)]), __("Billed {0}", [buildiary.money(s.billed)]), __("Paid {0}", [buildiary.money(s.paid)]), due].join(" · "), s.balance > 0 ? "orange" : "blue");
		});
	},
});
