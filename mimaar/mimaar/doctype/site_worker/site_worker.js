// Worker register: identity, police verification and the printed site card (with QR).
frappe.ui.form.on("Site Worker", {
	refresh(frm) {
		if (frm.is_new()) return;
		frm.add_custom_button(__("Print site card"), () => frm.print_doc());
		frappe.call({ method: "mimaar.api.worker_warnings", args: { name: frm.doc.name } }).then((r) => {
			const w = r.message || [];
			if (w.length) frm.dashboard.set_headline(w.map((x) => frappe.utils.escape_html(x)).join(" · "), "orange");
		});
	},
});
