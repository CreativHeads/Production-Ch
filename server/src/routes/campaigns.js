// Influencer campaigns & client roster management:
// Create campaigns (e.g. Coimbatore campaign), add influencers with auto-fetch
// from the Talent directory or automatic creation of new influencers, and export client sheets.
const multer = require("multer");
const ExcelJS = require("exceljs");
const config = require("../config");
const { db, nowDb, iso, bool, money, sequenceNext, insertId, pad } = require("../db");
const { wrap, ValidationError, notFound } = require("../errors");
const { normalizeName, normalizeInstagram } = require("../normalize");
const audit = require("../audit");
const T = require("../services/talent");

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: config.MAX_UPLOAD_MB * 1024 * 1024 } });

module.exports = function (r) {
  // ------------------------------------------------ GET /api/campaigns
  r.get("/campaigns", wrap(async (req, res) => {
    const scope = req.query.scope || "all";
    const q = db("campaigns").whereNull("deleted_at").orderBy("created_at", "desc");
    if (scope === "active") {
      q.whereNotIn("status", ["completed", "cancelled"]);
    } else if (scope === "planning" || scope === "draft") {
      q.whereIn("status", ["draft", "planning"]);
    } else if (scope === "in_progress") {
      q.where("status", "active");
    } else if (scope === "completed") {
      q.whereIn("status", ["completed", "cancelled"]);
    }

    if (req.query.q) {
      const term = `%${req.query.q.trim()}%`;
      q.where((w) => w.where("title", "like", term).orWhere("client_name", "like", term).orWhere("location", "like", term));
    }
    if (req.query.location) {
      q.where("location", "like", `%${req.query.location.trim()}%`);
    }

    const campaigns = await q;
    const cids = campaigns.map((c) => c.id);

    // Aggregate influencers per campaign
    const influencers = cids.length
      ? await db("campaign_influencers").whereIn("campaign_id", cids).orderBy("id", "asc")
      : [];

    const talentIds = [...new Set(influencers.map((inf) => inf.talent_id).filter(Boolean))];
    const photos = talentIds.length
      ? await db("talent_photos").whereIn("talent_id", talentIds).where({ is_primary: true })
      : [];
    const photoMap = new Map(photos.map((p) => [p.talent_id, T.mediaUrl(p.card || p.thumb)]));

    const infByCamp = new Map();
    for (const inf of influencers) {
      if (!infByCamp.has(inf.campaign_id)) infByCamp.set(inf.campaign_id, []);
      const livePhoto = inf.talent_id && photoMap.get(inf.talent_id);
      infByCamp.get(inf.campaign_id).push({
        ...inf,
        photo_url: livePhoto || inf.photo_url || null,
      });
    }

    res.json(
      campaigns.map((c) => {
        const infs = infByCamp.get(c.id) || [];
        const finalised = infs.filter((i) => i.status === "finalised" || i.status === "confirmed");
        const totalFixedRate = finalised.reduce((acc, i) => acc + Number(i.rate_fixed || 0), 0);
        return {
          id: c.id,
          code: c.code,
          title: c.title,
          client_name: c.client_name || "",
          location: c.location || "",
          start_date: c.start_date,
          end_date: c.end_date,
          budget: money(c.budget),
          currency: c.currency || "INR",
          status: c.status,
          notes: c.notes || "",
          created_at: iso(c.created_at),
          influencers_count: infs.length,
          finalised_count: finalised.length,
          total_fixed_rate: totalFixedRate,
          preview_photos: infs.map((i) => i.photo_url).filter(Boolean).slice(0, 5),
        };
      })
    );
  }));

  // ------------------------------------------------ POST /api/campaigns
  r.post("/campaigns", wrap(async (req, res) => {
    const b = req.body;
    const title = String(b.title || "").trim();
    if (!title) throw new ValidationError({ title: ["Campaign title is required."] });

    const seq = await sequenceNext("campaign_code");
    const code = `CAMP-${String(seq).padStart(4, "0")}`;
    const now = nowDb();

    const [id] = await db("campaigns").insert({
      title,
      client_name: String(b.client_name || "").trim(),
      code,
      location: String(b.location || "").trim(),
      start_date: b.start_date || null,
      end_date: b.end_date || null,
      budget: b.budget ? Number(b.budget) : null,
      currency: b.currency || "INR",
      status: b.status || "active",
      notes: String(b.notes || "").trim(),
      created_at: now,
      updated_at: now,
      created_by: req.user.id,
    });

    await audit.log(req, "campaign.created", { entityType: "campaign", entityId: id, label: `${title} (${code})` });

    const campaign = await db("campaigns").where({ id }).first();
    res.status(201).json(campaign);
  }));

  // ------------------------------------------------ GET /api/campaigns/:id
  r.get("/campaigns/:id", wrap(async (req, res) => {
    const c = await db("campaigns").where({ id: req.params.id }).whereNull("deleted_at").first();
    if (!c) throw notFound();

    const influencers = await db("campaign_influencers").where({ campaign_id: c.id }).orderBy("id", "asc");
    const talentIds = [...new Set(influencers.map((i) => i.talent_id).filter(Boolean))];

    const talentRows = talentIds.length ? await db("talent").whereIn("id", talentIds) : [];
    const tMap = new Map(talentRows.map((t) => [t.id, t]));

    const photos = talentIds.length
      ? await db("talent_photos").whereIn("talent_id", talentIds).where({ is_primary: true })
      : [];
    const photoMap = new Map(photos.map((p) => [p.talent_id, T.mediaUrl(p.card || p.thumb)]));

    const roster = influencers.map((inf) => {
      const talent = inf.talent_id ? tMap.get(inf.talent_id) : null;
      const livePhoto = inf.talent_id && photoMap.get(inf.talent_id);
      return {
        id: inf.id,
        campaign_id: inf.campaign_id,
        talent_id: inf.talent_id,
        cast_id: talent ? talent.cast_id : null,
        name: inf.name,
        photo_url: livePhoto || inf.photo_url || null,
        profile_url: inf.profile_url || "",
        platform: inf.platform || "Instagram",
        location: inf.location || (talent ? talent.city : ""),
        rate_fixed: money(inf.rate_fixed),
        date_available: inf.date_available || "",
        status: inf.status,
        remark: inf.remark || "",
        created_at: iso(inf.created_at),
      };
    });

    const finalised = roster.filter((i) => i.status === "finalised" || i.status === "confirmed");
    const totalFixedRate = finalised.reduce((acc, i) => acc + Number(i.rate_fixed || 0), 0);

    res.json({
      ...c,
      budget: money(c.budget),
      created_at: iso(c.created_at),
      influencers: roster,
      influencers_count: roster.length,
      finalised_count: finalised.length,
      total_fixed_rate: totalFixedRate,
    });
  }));

  // ------------------------------------------------ PATCH /api/campaigns/:id
  r.patch("/campaigns/:id", wrap(async (req, res) => {
    const c = await db("campaigns").where({ id: req.params.id }).whereNull("deleted_at").first();
    if (!c) throw notFound();

    const b = req.body;
    const upd = { updated_at: nowDb(), updated_by: req.user.id };
    if (b.title !== undefined) upd.title = String(b.title).trim();
    if (b.client_name !== undefined) upd.client_name = String(b.client_name).trim();
    if (b.location !== undefined) upd.location = String(b.location).trim();
    if (b.start_date !== undefined) upd.start_date = b.start_date || null;
    if (b.end_date !== undefined) upd.end_date = b.end_date || null;
    if (b.budget !== undefined) upd.budget = b.budget ? Number(b.budget) : null;
    if (b.status !== undefined) upd.status = b.status;
    if (b.notes !== undefined) upd.notes = String(b.notes).trim();

    await db("campaigns").where({ id: c.id }).update(upd);
    res.json(await db("campaigns").where({ id: c.id }).first());
  }));

  // ------------------------------------------------ DELETE /api/campaigns/:id
  r.delete("/campaigns/:id", wrap(async (req, res) => {
    const c = await db("campaigns").where({ id: req.params.id }).whereNull("deleted_at").first();
    if (!c) throw notFound();

    await db("campaigns").where({ id: c.id }).update({ deleted_at: nowDb(), deleted_by: req.user.id });
    res.json({ ok: true });
  }));

  // ------------------------------------------------ POST /api/campaigns/:id/influencers
  // Add influencer to campaign: if they already exist in Talent directory, link & fetch photo;
  // if new, automatically register them into the Talent directory under tag "Influencer"!
  r.post("/campaigns/:id/influencers", upload.single("photo"), wrap(async (req, res) => {
    const campaign = await db("campaigns").where({ id: req.params.id }).whereNull("deleted_at").first();
    if (!campaign) throw notFound();

    const b = req.body;
    const name = String(b.name || "").trim();
    if (!name) throw new ValidationError({ name: ["Influencer name is required."] });

    let talentId = b.talent_id ? Number(b.talent_id) : null;
    let talent = talentId ? await db("talent").where({ id: talentId }).first() : null;

    const nameNorm = normalizeName(name);
    const instaNorm = normalizeInstagram(b.profile_url || b.instagram || "");

    // 1. If no explicit talent_id provided, look up by name or instagram handle
    if (!talent) {
      talent = await db("talent")
        .whereNull("deleted_at")
        .where((w) => {
          w.where("name_normalized", nameNorm);
          if (instaNorm) w.orWhere("instagram_normalized", instaNorm);
        })
        .first();
    }

    const now = nowDb();

    // 2. If STILL not found in talent database, automatically create as a new talent!
    if (!talent) {
      const seq = await sequenceNext("cast_id");
      const cast_id = `CH-CAST-${pad(seq, 6)}`;
      const phone = String(b.phone || "").trim() || "0000000000";

      const [newId] = await db("talent").insert({
        cast_id,
        talent_type: "influencer",
        full_name: name,
        name_normalized: nameNorm,
        phone,
        phone_normalized: phone,
        city: String(b.location || campaign.location || "Coimbatore").trim(),
        state: "Tamil Nadu",
        country: "India",
        instagram: String(b.profile_url || b.instagram || "").trim(),
        instagram_normalized: instaNorm,
        primary_platform: b.platform || "Instagram",
        expected_fee: b.rate_fixed ? Number(b.rate_fixed) : null,
        internal_notes: String(b.remark || "").trim(),
        status: "active",
        created_at: now,
        updated_at: now,
        created_by: req.user.id,
        version: 1,
      });

      talent = await db("talent").where({ id: newId }).first();

      // Ensure category "influencer" is attached
      const infTerm = await db("terms").where({ kind: "category" }).whereIn("slug", ["influencer", "content-creator"]).first();
      if (infTerm) {
        await db("talent_categories").insert({ talent_id: talent.id, term_id: infTerm.id }).onConflict(["talent_id", "term_id"]).ignore();
      }
    } else {
      // Existing talent: make sure they also have influencer category or talent_type
      if (talent.talent_type !== "influencer" && talent.talent_type !== "both") {
        await db("talent").where({ id: talent.id }).update({ talent_type: "both", updated_at: now });
      }
      const infTerm = await db("terms").where({ kind: "category" }).whereIn("slug", ["influencer", "content-creator"]).first();
      if (infTerm) {
        await db("talent_categories").insert({ talent_id: talent.id, term_id: infTerm.id }).onConflict(["talent_id", "term_id"]).ignore();
      }
    }

    talentId = talent.id;

    // 3. Process photo if uploaded
    if (req.file) {
      try {
        await T.addPhoto(talent, req.file.buffer, { user: req.user, makePrimary: true });
      } catch (err) {
        console.warn("Failed to process photo for campaign influencer:", err.message);
      }
    }

    // 4. Retrieve primary photo
    const primary = await db("talent_photos").where({ talent_id: talent.id, is_primary: true }).first();
    const photoUrl = primary ? T.mediaUrl(primary.card || primary.thumb) : (b.photo_url || "");

    // 5. Insert into campaign_influencers
    const [infId] = await db("campaign_influencers").insert({
      campaign_id: campaign.id,
      talent_id: talent.id,
      name,
      photo_url: photoUrl,
      profile_url: String(b.profile_url || b.instagram || talent.instagram || "").trim(),
      platform: b.platform || talent.primary_platform || "Instagram",
      location: String(b.location || talent.city || campaign.location || "").trim(),
      rate_fixed: b.rate_fixed ? Number(b.rate_fixed) : null,
      date_available: String(b.date_available || "").trim(),
      status: b.status || "shortlisted",
      remark: String(b.remark || "").trim(),
      created_at: now,
      updated_at: now,
    });

    const created = await db("campaign_influencers").where({ id: infId }).first();
    res.status(201).json({
      ...created,
      cast_id: talent.cast_id,
      photo_url: photoUrl,
    });
  }));

  // ------------------------------------------------ PATCH /api/campaigns/:cid/influencers/:id
  r.patch("/campaigns/:cid/influencers/:id", upload.single("photo"), wrap(async (req, res) => {
    const inf = await db("campaign_influencers").where({ id: req.params.id, campaign_id: req.params.cid }).first();
    if (!inf) throw notFound();

    const b = req.body;
    const upd = { updated_at: nowDb() };
    if (b.name !== undefined) upd.name = String(b.name).trim();
    if (b.status !== undefined) upd.status = b.status;
    if (b.rate_fixed !== undefined) upd.rate_fixed = b.rate_fixed !== "" ? Number(b.rate_fixed) : null;
    if (b.date_available !== undefined) upd.date_available = String(b.date_available).trim();
    if (b.location !== undefined) upd.location = String(b.location).trim();
    if (b.profile_url !== undefined) upd.profile_url = String(b.profile_url).trim();
    if (b.remark !== undefined) upd.remark = String(b.remark).trim();

    if (req.file && inf.talent_id) {
      const talent = await db("talent").where({ id: inf.talent_id }).first();
      if (talent) {
        try {
          await T.addPhoto(talent, req.file.buffer, { user: req.user, makePrimary: true });
          const primary = await db("talent_photos").where({ talent_id: talent.id, is_primary: true }).first();
          if (primary) upd.photo_url = T.mediaUrl(primary.card || primary.thumb);
        } catch (err) {
          console.warn("Failed to process photo on patch:", err.message);
        }
      }
    }

    await db("campaign_influencers").where({ id: inf.id }).update(upd);
    res.json(await db("campaign_influencers").where({ id: inf.id }).first());
  }));

  // ------------------------------------------------ DELETE /api/campaigns/:cid/influencers/:id
  r.delete("/campaigns/:cid/influencers/:id", wrap(async (req, res) => {
    const inf = await db("campaign_influencers").where({ id: req.params.id, campaign_id: req.params.cid }).first();
    if (!inf) throw notFound();

    await db("campaign_influencers").where({ id: inf.id }).del();
    res.json({ ok: true });
  }));

  // ------------------------------------------------ GET /api/campaigns/:id/export
  // Export clean, styled Excel sheet for client presentation
  r.get("/campaigns/:id/export", wrap(async (req, res) => {
    const campaign = await db("campaigns").where({ id: req.params.id }).whereNull("deleted_at").first();
    if (!campaign) throw notFound();

    const influencers = await db("campaign_influencers").where({ campaign_id: campaign.id }).orderBy("id", "asc");

    const wb = new ExcelJS.Workbook();
    wb.creator = "TakeBoard by CreativHeads";
    wb.created = new Date();

    const ws = wb.addWorksheet("Finalised Client List", {
      views: [{ showGridLines: true }],
    });

    // Title and Meta rows
    ws.mergeCells("A1:H1");
    const titleCell = ws.getCell("A1");
    titleCell.value = `CAMPAIGN FINALIZED LIST: ${campaign.title.toUpperCase()}`;
    titleCell.font = { name: "Arial", size: 16, bold: true, color: { argb: "FFFFFFFF" } };
    titleCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0B0B0B" } };
    titleCell.alignment = { vertical: "middle", horizontal: "center" };
    ws.getRow(1).height = 36;

    ws.mergeCells("A2:H2");
    const subCell = ws.getCell("A2");
    subCell.value = `Client: ${campaign.client_name || "N/A"}  |  Location: ${campaign.location || "N/A"}  |  Dates: ${campaign.start_date || "TBC"} to ${campaign.end_date || "TBC"}  |  Generated by TakeBoard`;
    subCell.font = { name: "Arial", size: 10, italic: true, color: { argb: "FF555555" } };
    subCell.alignment = { vertical: "middle", horizontal: "center" };
    ws.getRow(2).height = 24;

    ws.addRow([]); // Blank spacer

    // Header Row
    const headerRow = ws.addRow([
      "#",
      "Influencer Name",
      "Social Profile / Handle",
      "Remarks / Deliverables",
      "Location",
      "Rate Fixed (₹)",
      "Date / Time Fixed",
      "Status",
    ]);
    headerRow.height = 26;
    headerRow.eachCell((cell) => {
      cell.font = { name: "Arial", size: 11, bold: true, color: { argb: "FFFFFFFF" } };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F1F1F" } };
      cell.alignment = { vertical: "middle", horizontal: "center" };
      cell.border = {
        top: { style: "thin", color: { argb: "FF333333" } },
        bottom: { style: "medium", color: { argb: "FF000000" } },
      };
    });

    let totalRate = 0;
    influencers.forEach((inf, idx) => {
      const rate = Number(inf.rate_fixed || 0);
      if (inf.status === "finalised" || inf.status === "confirmed") {
        totalRate += rate;
      }
      const row = ws.addRow([
        idx + 1,
        inf.name,
        inf.profile_url || "-",
        inf.remark || "-",
        inf.location || "-",
        rate > 0 ? rate : "-",
        inf.date_available || "TBD",
        inf.status ? inf.status.toUpperCase() : "SHORTLISTED",
      ]);
      row.height = 22;
      row.eachCell((cell, col) => {
        cell.font = { name: "Arial", size: 10 };
        cell.alignment = { vertical: "middle", horizontal: col === 1 || col === 8 ? "center" : col === 6 ? "right" : "left" };
        cell.border = { bottom: { style: "thin", color: { argb: "FFE0E0E0" } } };
      });
    });

    // Total Row
    ws.addRow([]);
    const totalRow = ws.addRow([
      "",
      "",
      "",
      "",
      "TOTAL FINALISED BUDGET:",
      totalRate,
      "",
      "",
    ]);
    totalRow.height = 26;
    totalRow.getCell(5).font = { name: "Arial", size: 11, bold: true };
    totalRow.getCell(6).font = { name: "Arial", size: 12, bold: true, color: { argb: "FF0A5C1E" } };
    totalRow.getCell(6).alignment = { horizontal: "right", vertical: "middle" };

    ws.columns = [
      { width: 6 },
      { width: 26 },
      { width: 26 },
      { width: 32 },
      { width: 18 },
      { width: 20 },
      { width: 20 },
      { width: 18 },
    ];

    const safeFilename = `${(campaign.title || "campaign").replace(/[^a-zA-Z0-9_-]/g, "_")}_Finalised_List.xlsx`;
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="${safeFilename}"`);

    await wb.xlsx.write(res);
    res.end();
  }));
};
