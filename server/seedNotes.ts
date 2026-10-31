import fs from 'node:fs';
import path from 'node:path';

interface SeedNoteSpec {
  folder: string;
  title: string;
  body: string;
}

const SEED_NOTES: SeedNoteSpec[] = [
  // 1. STRATEGY (6 notes)
  {
    folder: 'strategy',
    title: '2026 Annual Roadmap',
    body: `# 2026 Annual Roadmap

Updated: 2026-10-12 · Owner: Clara Vance

Alder & Press enters Q4 with three primary strategic targets: scaling wholesale specialty roast volume by 28%, commissioning the [[Eastside Roastery Expansion]] before December 15, and launching [[RTD Canned Nitro Launch Plan]] across 18 regional grocers.

Key milestones:
- Maintain gross margin above 54% per [[Pricing & Margin Architecture]].
- Convert four Tier-2 cafes into Tier-1 anchor accounts under [[Wholesale Partner Tiering]].
- Retire legacy 5kg batch roaster once [[Loring S15 Roasting Protocol]] hits 92% utilization.
- Keep cash runway strictly above 9.5 months as tracked in [[Q3 Cash Flow & Runway Summary]].`
  },
  {
    folder: 'strategy',
    title: 'Pricing & Margin Architecture',
    body: `# Pricing & Margin Architecture

Updated: 2026-09-28

Our 2026 pricing discipline protects margin against C-market green coffee volatility while keeping flagship retail bags at $21.00 per 12oz (340g).

Wholesale pricing tiers:
- Tier 1 Anchor (>80 lbs/week): $11.80/lb blended espresso, $13.40/lb single origin. Gross margin target: 49%.
- Tier 2 Standard (25–80 lbs/week): $12.90/lb blended espresso, $14.60/lb single origin. Gross margin target: 54%.
- Office Subscriptions (see [[Studio Marrow Office Subscription]]): $15.25/lb delivered biweekly, 61% gross margin.

Reference [[Unit Economics Per Pound]] and [[Green Coffee Forward Contracts]] before approving any custom discount.`
  },
  {
    folder: 'strategy',
    title: 'Eastside Roastery Expansion',
    body: `# Eastside Roastery Expansion

Updated: 2026-10-18

We signed a 5-year industrial lease at 412 SE Alder Street (3,800 sq ft) at $4,650/month triple-net. Electrical three-phase 400A upgrade passed city inspection on October 9.

Remaining critical path items:
1. Afterburner ductwork rigging scheduled November 6 ($11,400 contractor quote).
2. Dedicated cupping & training lab buildout for [[Home Barista Workshop Curriculum]].
3. Relocate [[Cold Brew Kegging SOP]] line and 3-barrel bright tank over Thanksgiving weekend to avoid wholesale fulfillment downtime.

CapEx budget remaining: $24,800 out of $85,000 allocation in [[Q3 Cash Flow & Runway Summary]].`
  },
  {
    folder: 'strategy',
    title: 'Wholesale Partner Tiering',
    body: `# Wholesale Partner Tiering

Updated: 2026-08-30

Every wholesale partner is classified by weekly poundage and equipment care compliance:

- **Tier 1 Anchor Partners**: Receive free quarterly preventive service per [[Equipment Preventive Maintenance]], custom dial-in training, and priority micro-lot allocation such as [[Colombia Huila Pink Bourbon]]. Current anchors include [[Hotel Vance Wholesale Account]] and [[Kestrel Bakery Supply Agreement]].
- **Tier 2 Café Partners**: Receive semi-annual calibration checks and standard 48-hour roast-to-ship turnaround.
- **Hospitality & Seasonal**: Custom seasonal contracts like [[Harborline Ferry Seasonal Contract]]. Require 50% deposit on initial hardware installation.`
  },
  {
    folder: 'strategy',
    title: 'Competitor Landscape Q4',
    body: `# Competitor Landscape Q4

Updated: 2026-10-04

Regional specialty roasters raised wholesale espresso prices by an average of $1.15/lb in September due to Brazilian frost scares:
- ** Hearthstone Coffee**: Now $13.75/lb wholesale minimum; 5-day lead time; dropped free grinder loaners.
- **Tidewater Roasters**: Focused heavily on supermarket 12oz bags ($17.99 promo pricing), sacrificing freshness dates.
- **Vesper Espresso Lab**: Competes for boutique offices against [[Studio Marrow Office Subscription]], but lacks decaf quality comparable to [[Decaf Mountain Water Process]].

Our edge remains 24-hour local delivery, [[Water Filtration & TDS Standards]] consulting, and transparent farm-gate premiums under [[Sustainability & Direct Trade Charter]].`
  },
  {
    folder: 'strategy',
    title: 'Sustainability & Direct Trade Charter',
    body: `# Sustainability & Direct Trade Charter

Updated: 2026-07-19

Alder & Press commits to paying a minimum FOB floor of $4.10/lb for washed lots and $4.65/lb for experimental naturals, regardless of commodity C-price dips.

2026 Direct Trade benchmarks:
- 78% of annual green volume contracted with producer-level transparency (see [[Green Coffee Forward Contracts]]).
- 100% compostable degassing valves on 12oz retail bags; reusable 22lb food-grade totes for local accounts like [[Kestrel Bakery Supply Agreement]] and [[Hotel Vance Wholesale Account]], eliminating 4,200 single-use 5lb bags annually.
- Loring smokeless recirculation cuts natural gas usage by 72% per [[Loring S15 Roasting Protocol]].`
  },

  // 2. OPERATIONS (6 notes)
  {
    folder: 'operations',
    title: 'Loring S15 Roasting Protocol',
    body: `# Loring S15 Roasting Protocol

Updated: 2026-10-02 · Head Roaster: Mateo Silva

Standard operating parameters for our 15kg Loring Falcon (see [[Equipment Lease - Loring S15]]):
- **Warmup**: 25 minutes idle at 405°F charge temperature before first batch.
- **Batch Size**: 12.2 kg green charge (81% capacity) for optimal convective airflow.
- **Flagship Espresso ([[Autumn Espresso Blend - Nightjar]])**: Charge 408°F, turning point at 1:22, yellow at 4:35, first crack at 8:05, 19.5% development time ratio (drop at 9:58, 414.5°F).
- **Light Filter ([[Ethiopia Worka Sakaro Lot 14]])**: Charge 402°F, fast airflow ramp at 6:30, 14.2% development time, drop at 404°F.
- **Between-Batch Protocol**: Empty chaff cyclone every 6 roasts; log weight loss % (target 14.1%–15.6%).`
  },
  {
    folder: 'operations',
    title: 'Morning Bar Opening Checklist',
    body: `# Morning Bar Opening Checklist

Updated: 2026-09-14

Tasting room bar opens at 07:00 sharp Tuesday–Sunday. Opener arrives at 06:15:
1. Purge La Marzocco Linea PB groupheads for 5 seconds; check boiler pressure (1.2 bar steam, 9.0 bar pump).
2. Test incoming water port with handheld meter: must read 95–125 ppm TDS per [[Water Filtration & TDS Standards]].
3. Dial in [[Autumn Espresso Blend - Nightjar]]: 19.5g dose → 39g yield in 27–29 seconds at 200.5°F.
4. Dial in batch brew with [[Ethiopia Worka Sakaro Lot 14]] at 1:16.5 ratio (122g coffee to 2.0L water).
5. Verify pastry courier arrival from [[Kestrel Bakery Supply Agreement]] by 06:45.`
  },
  {
    folder: 'operations',
    title: 'Green Bean Inventory & Par Levels',
    body: `# Green Bean Inventory & Par Levels

Updated: 2026-10-25

Current warehouse count (climate-controlled at 64°F, 55% RH):
- Brazil Carmo de Minas Pulped Natural (Nightjar base): 42 bags (60kg GrainPro) — 9 weeks cover.
- [[Ethiopia Worka Sakaro Lot 14]]: 14 bags remaining — reorder trigger at 10 bags.
- [[Colombia Huila Pink Bourbon]]: 8 bags (35kg vacuum boxes) — reserved for retail & Tier-1 partners.
- Mexico Chiapas [[Decaf Mountain Water Process]]: 11 bags — par level is 8 bags.

Warehouse drawdown aligns with [[Green Coffee Forward Contracts]]. Conduct physical bag count every Friday at 15:00.`
  },
  {
    folder: 'operations',
    title: 'Water Filtration & TDS Standards',
    body: `# Water Filtration & TDS Standards

Updated: 2026-08-11

Specialty coffee is 98.5% water; poor mineralization voids our [[Equipment Preventive Maintenance]] warranty and flattens acidity.

Target specification (Pentair Everpure Claris Ultra + RO blend valve):
- **Total Dissolved Solids (TDS)**: 95–125 ppm (ideal sweet spot: 110 ppm).
- **Total Hardness (GH)**: 50–75 ppm as CaCO3.
- **Alkalinity / Buffer (KH)**: 35–45 ppm as CaCO3.
- **pH**: 7.0 – 7.4; zero detectable chlorine/chloramine.

Note: [[Bramble & Co Dispute Log]] stemmed from an bypassed softened cartridge reading 260 ppm hardness, scaling their boiler.`
  },
  {
    folder: 'operations',
    title: 'Cold Brew Kegging SOP',
    body: `# Cold Brew Kegging SOP

Updated: 2026-09-20

Used for 5-gallon Sankey nitro kegs and upcoming [[RTD Canned Nitro Launch Plan]]:
1. Grind 28 lbs washed Colombia &Nightjar base coarse (setting 8.5 on Mahlkönig EK43).
2. Steep in 35 gallons filtered 68°F water for 16 hours in stainless jacketed tank; agitate paddle for 90 seconds at hour 1.
3. Transfer through 5-micron pleated filter into bright tank, chill to 34°F, dilute concentrate to 3.8% TDS.
4. Purge sanitized kegs with food-grade nitrogen (<0.5% dissolved O2), fill to 5.0 gal, pressurize headspace to 38 PSI.
5. Shelf life: 28 days refrigerated. Primary buyers: [[Studio Marrow Office Subscription]] and [[Harborline Ferry Seasonal Contract]].`
  },
  {
    folder: 'operations',
    title: 'Equipment Preventive Maintenance',
    body: `# Equipment Preventive Maintenance

Updated: 2026-10-08 · Lead Tech: Devon Cho

Quarterly service checklist for tasting room and Tier-1 [[Wholesale Partner Tiering]] loaner machines:
- Replace silicone group gaskets (8.0mm conical) and precision dispersion screens every 90 days.
- Rebuild steam wand vacuum breakers and anti-suction valves every 6 months.
- Inspect Mahlkönig E65S GbW burrs at 650 kg throughput; swap steel burrs at 900 kg.
- Check water cartridge flowmeter totalizer against [[Water Filtration & TDS Standards]].

Emergency dispatch SLA: 4 hours within metro zone for [[Hotel Vance Wholesale Account]]; 24 hours for standard accounts.`
  },

  // 3. CLIENTS (6 notes)
  {
    folder: 'clients',
    title: 'Hotel Vance Wholesale Account',
    body: `# Hotel Vance Wholesale Account

Updated: 2026-10-21 · Contact: Julian Mercer (F&B Director)

Our largest hospitality account ($7,400/month recurring revenue). Renews on **January 15, 2027** with an automatic 12-month extension unless 45 days notice is given.

Account details:
- Weekly volume: 115 lbs [[Autumn Espresso Blend - Nightjar]] + 30 lbs [[Decaf Mountain Water Process]] for lobby bar and 140 guest suites.
- Pricing: Tier 1 Anchor rate ($11.80/lb espresso) per [[Pricing & Margin Architecture]].
- Loaned hardware: 2x La Marzocco Linea PB 2-group machines + 3x Mahlkönig grinders covered under [[Equipment Preventive Maintenance]].
- Upsell opportunity: Pitching [[RTD Canned Nitro Launch Plan]] for guest room minibars in November.`
  },
  {
    folder: 'clients',
    title: 'Kestrel Bakery Supply Agreement',
    body: `# Kestrel Bakery Supply Agreement

Updated: 2026-10-05 · Contact: Nadia Lin

Reciprocal anchor partnership across Kestrel's two sourdough bakeries:
- Kestrel purchases 85 lbs/week total (60 lbs [[Autumn Espresso Blend - Nightjar]], 25 lbs [[Ethiopia Worka Sakaro Lot 14]]), delivered Tuesdays & Fridays in zero-waste totes per [[Sustainability & Direct Trade Charter]].
- In return, Kestrel supplies Alder & Press tasting room with 45 laminated pastries daily at 32% wholesale discount (see [[Morning Bar Opening Checklist]]).
- Net payment terms: Net-15 via ACH, zero late invoices in 18 months.`
  },
  {
    folder: 'clients',
    title: 'Studio Marrow Office Subscription',
    body: `# Studio Marrow Office Subscription

Updated: 2026-09-29 · Contact: Marcus Bell (Operations)

85-person industrial design studio on SE Water Ave:
- Biweekly standing order: 36 lbs whole bean ([[Colombia Huila Pink Bourbon]] & Nightjar) at $15.25/lb plus four 5-gallon nitro kegs per [[Cold Brew Kegging SOP]] ($135/keg).
- Monthly contract value: $2,180 auto-billed on the 1st of each month.
- Booked a private team session of [[Home Barista Workshop Curriculum]] for December 4 ($1,200 flat event fee for 12 designers).`
  },
  {
    folder: 'clients',
    title: 'Harborline Ferry Seasonal Contract',
    body: `# Harborline Ferry Seasonal Contract

Updated: 2026-10-15 · Contact: Capt. Hannah Sato (Commissary Mgr)

Commuter & tourist ferry fleet serving three terminal routes:
- Winter schedule (Nov–Mar): 55 lbs/week drip blend + 6 kegs [[Cold Brew Kegging SOP]] biweekly.
- Peak summer schedule (May–Sep): 140 lbs/week + 18 kegs biweekly.
- Payment terms: Net-30 municipal procurement portal. Classified under Hospitality in [[Wholesale Partner Tiering]].`
  },
  {
    folder: 'clients',
    title: 'Bramble & Co Dispute Log',
    body: `# Bramble & Co Dispute Log

Updated: 2026-10-24 · Status: Resolved with Probation

Summary of October invoice #4082 dispute ($1,148):
- Bramble & Co claimed [[Autumn Espresso Blend - Nightjar]] tasted "ashy and thin" and withheld October payment.
- Tech Devon Cho inspected on Oct 19: found their plumber had left the bypass valve open on their water head, feeding raw 260 ppm municipal water in violation of [[Water Filtration & TDS Standards]] and scaling the heat exchanger.
- Resolution: We descaled their group at parts-only cost ($185), waived late fee, and received full $1,148 wire on Oct 23. Account remains on Net-7 card-on-file terms.`
  },
  {
    folder: 'clients',
    title: 'Northstar Bookshop Pop-Up',
    body: `# Northstar Bookshop Pop-Up

Updated: 2026-10-19 · Contact: Eliॉट Reed

Holiday weekend espresso cart residency inside Northstar Bookshop (Nov 28 – Dec 24, Fri–Sun 10:00–17:00):
- Revenue share: Alder & Press keeps 85% of drink & retail bag sales; Northstar takes 15% in lieu of rent.
- Featured menu: [[Colombia Huila Pink Bourbon]] pour-overs, cardamom cortados, and holiday 3-bean gift boxes.
- Staffing covered by two senior baristas on weekend differential per [[Payroll & Barista Compensation]].`
  },

  // 4. FINANCE (6 notes)
  {
    folder: 'finance',
    title: 'Q3 Cash Flow & Runway Summary',
    body: `# Q3 Cash Flow & Runway Summary

Updated: 2026-10-10 · Prepared by: Clara Vance

Q3 2026 Financial Snapshot (Jul–Sep):
- **Gross Revenue**: $248,600 (+19% YoY). Wholesale 62%, Tasting Room 27%, Subscriptions/Workshops 11%.
- **Gross Margin**: 54.8% (exceeding 54.0% target in [[Pricing & Margin Architecture]]).
- **Operating Expenses**: $109,400 (including [[Payroll & Barista Compensation]] and [[Equipment Lease - Loring S15]]).
- **Net Operating Cash Flow**: +$26,800 for the quarter.
- **Operating Cash on Hand**: $142,500 (excluding [[Tax Reserve & Quarterly Filings]] account), representing **10.8 months runway** after remaining [[Eastside Roastery Expansion]] CapEx.`
  },
  {
    folder: 'finance',
    title: 'Payroll & Barista Compensation',
    body: `# Payroll & Barista Compensation

Updated: 2026-09-01

Total monthly payroll burden: $28,400 across 7 FTEs and 2 part-time weekend staff:
- **Lead Baristas**: $23.50/hr base + pooled digital/cash tips (averaging +$7.80/hr = $31.30/hr effective).
- **Production & Delivery Associate**: $25.00/hr + full medical/dental stipend ($450/mo).
- **Head Roaster (Mateo)**: $74,000 salary + $0.12/lb quarterly quality bonus tied to [[Loring S15 Roasting Protocol]] consistency.
- **Lead Tech (Devon)**: $72,000 salary.
- **Pop-up / Event Differential**: +$3.00/hr for offsite shifts such as [[Northstar Bookshop Pop-Up]].`
  },
  {
    folder: 'finance',
    title: 'Equipment Lease - Loring S15',
    body: `# Equipment Lease - Loring S15

Updated: 2026-06-15

60-month commercial equipment lease with Northwest Capital Equipment:
- **Monthly Payment**: $2,140 due on the 5th of each month (6.4% fixed APR).
- **Payoff / Buyout Date**: August 5, 2028 ($1.00 bargain purchase option at maturity).
- **Remaining Principal Balance**: $44,920 as of October 2026.
- Insurance rider requires semi-annual flue & cyclone inspection documented under [[Loring S15 Roasting Protocol]].`
  },
  {
    folder: 'finance',
    title: 'Green Coffee Forward Contracts',
    body: `# Green Coffee Forward Contracts

Updated: 2026-10-14 · Importer Partners: Red Fox & Osito

Locked fixed-price forward positions through Q2 2027 to insulate [[Pricing & Margin Architecture]]:
1. **Brazil Carmo de Minas** (180 bags × 60kg): Fixed at $3.95/lb FOT Oakland, drawdown 20 bags/month.
2. **[[Ethiopia Worka Sakaro Lot 14]]** (45 bags × 60kg): Fixed at $5.35/lb FOB + $0.38/lb freight/carry.
3. **[[Colombia Huila Pink Bourbon]]** (25 boxes × 35kg): Direct trade microlot at $6.40/lb landed.
4. **Mexico [[Decaf Mountain Water Process]]** (40 bags × 60kg): Fixed at $4.70/lb landed.

Storage carry fee kicks in after 90 days free warehouse period ($0.035/lb/month).`
  },
  {
    folder: 'finance',
    title: 'Unit Economics Per Pound',
    body: `# Unit Economics Per Pound

Updated: 2026-09-25

Fully loaded cost of goods sold (COGS) for 1.00 lb roasted [[Autumn Espresso Blend - Nightjar]]:
- Weighted Green Bean Cost: $4.22/lb green ÷ 0.852 roast yield (14.8% moisture/weight loss) = **$4.95/lb roasted**.
- Packaging (12oz retail bag + valve + label, prorated to 1 lb): **$0.68** (or **$0.09/lb** in reusable wholesale totes per [[Sustainability & Direct Trade Charter]]).
- Direct Roast Labor & Gas ([[Loring S15 Roasting Protocol]]): **$0.62/lb**.
- **Total Loaded COGS**: **$5.66/lb** in wholesale totes (52% margin at $11.80 Tier-1; 56% margin at $12.90 Tier-2) and **$6.25/lb** bagged.`
  },
  {
    folder: 'finance',
    title: 'Tax Reserve & Quarterly Filings',
    body: `# Tax Reserve & Quarterly Filings

Updated: 2026-10-16 · CPA: Halcyon Advisory

Dedicated high-yield tax reserve account (4.45% APY) swept automatically on the 15th and 30th:
- Sweep rule: 14% of net operating cash flow + 100% of collected municipal/payroll withholdings.
- Current Tax Reserve Balance: **$31,200** (separate from $142,500 operating cash in [[Q3 Cash Flow & Runway Summary]]).
- Q3 Federal & Oregon estimated payment ($8,950) paid Sept 15; Q4 estimated voucher due **January 15, 2027**.
- Equipment depreciation schedule includes Section 179 election planned for [[Eastside Roastery Expansion]] lab hardware.`
  },

  // 5. PRODUCT (6 notes)
  {
    folder: 'product',
    title: 'Autumn Espresso Blend - Nightjar',
    body: `# Autumn Espresso Blend - Nightjar

Updated: 2026-10-01

Our year-round workhorse seasonal espresso blend, representing 58% of total roasted poundage.

Current Autumn composition:
- **65% Brazil Carmo de Minas** (Pulped Natural — dark cacao, roasted hazelnut, syrupy body).
- **35% Washed Guatemala Huehuetenango** (stone fruit brightness, structured caramel finish).

Roast curve defined in [[Loring S15 Roasting Protocol]]; bar recipe in [[Morning Bar Opening Checklist]]. Served daily at [[Hotel Vance Wholesale Account]] and [[Kestrel Bakery Supply Agreement]].`
  },
  {
    folder: 'product',
    title: 'Ethiopia Worka Sakaro Lot 14',
    body: `# Ethiopia Worka Sakaro Lot 14

Updated: 2026-09-18

Gedeb District, Gedeo Zone · 2,150 MASL · Washed Heirloom (74110 & 74112).

Cupping profile (88.25 SCA points): Jasmine blossom, white peach, bergamot tea, crisp Meyer lemon finish.
- Retail price: $22.50 / 12oz bag.
- Wholesale single-origin rate: $13.40/lb Tier-1, $14.60/lb Tier-2 per [[Pricing & Margin Architecture]].
- Inventory status tracked in [[Green Bean Inventory & Par Levels]]. Featured batch brew on [[Morning Bar Opening Checklist]].`
  },
  {
    folder: 'product',
    title: 'Colombia Huila Pink Bourbon',
    body: `# Colombia Huila Pink Bourbon

Updated: 2026-10-07

Producer: Rodrigo Sanchez, Finca Monteblanco (Palestina, Huila · 1,780 MASL). Washed 36-hour anaerobic mucilage rest.

Cupping profile (89.0 SCA points): Pink grapefruit, hibiscus, honeycomb, silky raspberry acidity.
- Limited allocation: 8 vacuum boxes left in [[Green Bean Inventory & Par Levels]].
- Featured pour-over for [[Northstar Bookshop Pop-Up]] and executive subscription bags at [[Studio Marrow Office Subscription]].`
  },
  {
    folder: 'product',
    title: 'Decaf Mountain Water Process',
    body: `# Decaf Mountain Water Process

Updated: 2026-08-22

Coatepec & Huatusco smallholder cooperative, Mexico · 99.9% caffeine-free using glacial water from Pico de Orizaba with zero chemical solvents.

Cupping profile: Graham cracker, milk chocolate, poached pear.
- Charge 12°F lower (396°F) on [[Loring S15 Roasting Protocol]] because decaffeinated cellular structure browns faster and runs early into first crack.
- Key differentiator noted in [[Competitor Landscape Q4]] and ordered weekly (30 lbs/wk) by [[Hotel Vance Wholesale Account]].`
  },
  {
    folder: 'product',
    title: 'RTD Canned Nitro Launch Plan',
    body: `# RTD Canned Nitro Launch Plan

Updated: 2026-10-22

8oz sleek matte-black nitrogen-dosed cans launching January 2027 from [[Eastside Roastery Expansion]]:
- Base recipe adapted from [[Cold Brew Kegging SOP]] using 70% Nightjar base + 30% washed Ethiopia for natural floral sweetness (0g sugar, 165mg caffeine).
- Mobile canning co-packer minimum run: 6,000 cans ($0.94/can loaded COGS; wholesale case of 12 at $26.40 = $2.20/can; MSRP $3.99).
- Pre-commitments: 40 cases/month soft-committed by [[Hotel Vance Wholesale Account]] minibars + 18 specialty grocers.`
  },
  {
    folder: 'product',
    title: 'Home Barista Workshop Curriculum',
    body: `# Home Barista Workshop Curriculum

Updated: 2026-09-10

2.5-hour Saturday hands-on sensory & espresso extraction class ($95/seat, capped at 8 guests; moving to new lab in [[Eastside Roastery Expansion]]):
- Module 1 (30m): Freshness, burr geometry, and [[Water Filtration & TDS Standards]] at home.
- Module 2 (60m): Dose-yield-time dialing on [[Autumn Espresso Blend - Nightjar]] (tasting sour under-extraction vs. astringent channeling).
- Module 3 (60m): Microfoam milk texturing & heart/tulip latte art.
- Private corporate buyouts priced at $1,200 flat (booked Dec 4 by [[Studio Marrow Office Subscription]]).`
  }
];

export function ensureSeedNotes(notesRoot: string): void {
  const capturesDir = path.join(notesRoot, 'captures');
  fs.mkdirSync(capturesDir, { recursive: true });

  // Count existing markdown files
  let existingCount = 0;
  const countMd = (dir: string) => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) countMd(full);
      else if (entry.isFile() && entry.name.endsWith('.md')) existingCount++;
    }
  };
  countMd(notesRoot);

  if (existingCount > 0) {
    return;
  }

  for (const spec of SEED_NOTES) {
    const dir = path.join(notesRoot, spec.folder);
    fs.mkdirSync(dir, { recursive: true });
    const filePath = path.join(dir, `${spec.title}.md`);
    fs.writeFileSync(filePath, spec.body.trim() + '\n', 'utf-8');
  }
}
