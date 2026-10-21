// Mimaar: shared helpers for the forms (scanning, sharing) and right-to-left Urdu.
(function () {
	const RTL = ["ar", "he", "fa", "ps", "ur"];
	if (frappe.utils) frappe.utils.is_rtl = function (lang = null) { return RTL.includes(lang || frappe.boot.lang); };

	window.mimaar = window.mimaar || {};
	const M = window.mimaar;

	// pick a file (photo or PDF; the phone offers the camera) and return its URL
	M.pick_file = function (opts = {}) {
		return new Promise((resolve) => {
			new frappe.ui.FileUploader({
				doctype: opts.doctype, docname: opts.docname, folder: "Home/Attachments",
				restrictions: { allowed_file_types: opts.types || ["image/*", "application/pdf"] },
				allow_multiple: false, make_attachments_public: false,
				on_success: (file) => resolve(file.file_url),
			});
		});
	};

	M.ai_on = function () { return !!(frappe.boot.mimaar && frappe.boot.mimaar.ai); };

	M.open_whatsapp = function (m) {
		if (!m) return;
		if (!m.phone) frappe.show_alert({ message: __("No mobile number for this supplier: choose the contact in WhatsApp."), indicator: "orange" });
		window.open(m.whatsapp, "_blank");
	};
	M.email_link = function (m, subject) {
		const body = (m.text || "") + "\n";
		window.open(`mailto:${encodeURIComponent(m.email || "")}?subject=${encodeURIComponent(subject || "")}&body=${encodeURIComponent(body)}`, "_blank");
	};
	M.share = function (frm, supplier) {
		return frappe.call({ method: "mimaar.api.share_link", args: { doctype: frm.doctype, name: frm.doc.name, supplier: supplier || null }, freeze: true })
			.then((r) => M.open_whatsapp(r.message));
	};
	M.pdf = function (frm) {
		window.open(`/api/method/frappe.utils.print_format.download_pdf?doctype=${encodeURIComponent(frm.doctype)}&name=${encodeURIComponent(frm.doc.name)}`);
	};
	// "Send" buttons on a submitted document; nothing for drafts
	M.send_buttons = function (frm, supplier) {
		if (frm.doc.docstatus !== 1) return;
		frm.add_custom_button(__("PDF"), () => M.pdf(frm), __("Send"));
		frm.add_custom_button(__("WhatsApp"), () => M.share(frm, supplier), __("Send"));
		frm.add_custom_button(__("Email"), () => frm.email_doc(), __("Send"));
	};

	M.money = (v) => format_currency(v || 0, frappe.defaults.get_default("currency"));
	M.save_first = async function (frm) {
		if (frm.is_new() || frm.is_dirty()) await frm.save();
	};
})();
