'use strict';

const xmlEscape = (s = '') =>
  String(s).replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]));

const digitsOnly = (v) => String(v || '').replace(/\D/g, '');

const toISODateOnly = (input) => {
  if (!input) return '';
  const d = new Date(input);
  if (Number.isNaN(d.getTime())) return '';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

const toISODateTimeMidnight = (input) => {
  const date = toISODateOnly(input);
  if (!date) return '';
  return `${date}T00:00:00`;
};

const toISODateTimeWithOptionalTime = (dateInput, timeHHMM) => {
  const date = toISODateOnly(dateInput);
  if (!date) return '';
  const m = String(timeHHMM || '').trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return `${date}T00:00:00`;
  const hh = String(Math.max(0, Math.min(23, Number(m[1]) || 0))).padStart(2, '0');
  const mm = String(Math.max(0, Math.min(59, Number(m[2]) || 0))).padStart(2, '0');
  return `${date}T${hh}:${mm}:00`;
};

const epochSeconds = (input) => {
  const d = new Date(input || Date.now());
  if (Number.isNaN(d.getTime())) return null;
  return Math.floor(d.getTime() / 1000);
};

const normalizeGenderXsd = (value) => {
  const v = String(value || '').trim().toLowerCase();
  if (!v) return null;
  if (['w', 'f', 'female', 'weiblich'].includes(v)) return 'female';
  if (['m', 'male', 'männlich'].includes(v)) return 'male';
  if (['d', 'divers', 'diverse', 'other'].includes(v)) return 'diverse';
  if (['frau'].includes(v)) return 'female';
  if (['mann'].includes(v)) return 'male';
  return null;
};

const normalizeSexXsd = (value) => {
  const v = String(value || '').trim().toLowerCase();
  if (!v) return null;
  if (['w', 'f', 'female', 'weiblich'].includes(v)) return 'female';
  if (['m', 'male', 'männlich'].includes(v)) return 'male';
  return null;
};

const normalizeIban = (iban) => String(iban || '').replace(/[^0-9A-Za-z]/g, '').toUpperCase();

const bool01 = (val) => (val ? '1' : '0');

const assertNonEmpty = (label, value) => {
  if (!value || !String(value).trim()) throw new Error(`${label} fehlt`);
  return String(value).trim();
};

const parseZipCityFromOneLine = (line) => {
  const s = String(line || '').replace(/\s+/g, ' ').trim();
  const m = s.match(/\b(\d{4})\s+([A-Za-zÀ-ÿ' -]{2,})\b/);
  if (!m) return { zip: '', city: '' };
  return { zip: m[1], city: String(m[2]).trim() };
};

const buildPostal = ({ street = '', houseNo = '', zip = '', city = '', country = 'CH', stateCode = '' }) => {
  const zipVal = assertNonEmpty('PLZ', zip);
  const cityVal = assertNonEmpty('Ort', city);
  const streetName = String(street || '').trim();
  const house = String(houseNo || '').trim();
  const streetLine = [streetName, house].filter(Boolean).join(' ').trim();
  const streetAttrs = [
    streetName ? ` street_name="${xmlEscape(streetName)}"` : '',
    house ? ` house_no="${xmlEscape(house)}"` : ''
  ].join('');
  const streetEl = streetLine
    ? `<invoice:street${streetAttrs}>${xmlEscape(streetLine)}</invoice:street>`
    : '';
  const zipAttrs = stateCode ? ` state_code="${xmlEscape(stateCode)}"` : '';
  return `<invoice:postal>
    ${streetEl}
    <invoice:zip${zipAttrs}>${xmlEscape(zipVal)}</invoice:zip>
    <invoice:city>${xmlEscape(cityVal)}</invoice:city>
    <invoice:country country_code="${xmlEscape(String(country || 'CH').toUpperCase())}">${xmlEscape(String(country || 'CH').toUpperCase())}</invoice:country>
  </invoice:postal>`;
};

const buildCompany = ({ companyname, department = '', postal, phone = '', email = '' }) => {
  const name = assertNonEmpty('companyname', companyname);
  const dept = String(department || '').trim();
  const phoneVal = String(phone || '').trim();
  const emailVal = String(email || '').trim();
  return `<invoice:company>
    <invoice:companyname>${xmlEscape(name)}</invoice:companyname>
    ${dept ? `<invoice:department>${xmlEscape(dept)}</invoice:department>` : ''}
    ${postal}
    ${phoneVal ? `<invoice:telecom><invoice:phone>${xmlEscape(phoneVal)}</invoice:phone></invoice:telecom>` : ''}
    ${emailVal ? `<invoice:online><invoice:email>${xmlEscape(emailVal)}</invoice:email></invoice:online>` : ''}
  </invoice:company>`;
};

const buildPerson = ({ familyname, givenname, postal, phone = '', email = '' }) => {
  const family = assertNonEmpty('familyname', familyname);
  const given = assertNonEmpty('givenname', givenname);
  const phoneVal = String(phone || '').trim();
  const emailVal = String(email || '').trim();
  return `<invoice:person>
    <invoice:familyname>${xmlEscape(family)}</invoice:familyname>
    <invoice:givenname>${xmlEscape(given)}</invoice:givenname>
    ${postal}
    ${phoneVal ? `<invoice:telecom><invoice:phone>${xmlEscape(phoneVal)}</invoice:phone></invoice:telecom>` : ''}
    ${emailVal ? `<invoice:online><invoice:email>${xmlEscape(emailVal)}</invoice:email></invoice:online>` : ''}
  </invoice:person>`;
};

function buildGeneralInvoice50RequestXML(claim, opts = {}) {
  const {
    language = 'de',
    modus = 'production',
    guid = null,
    defaults = {
      debitor_person_gln: '2099999999998',
      via_gln: '2099999999999',
    },
  } = opts || {};

  const inv = claim?.invoice || {};
  const prov = claim?.provider || {};
  const pat = claim?.patient || {};
  const ins = claim?.insurer || null;
  const setl = claim?.settlement || {};
  const services = Array.isArray(claim?.services) ? claim.services : [];
  const totals = claim?.totals || {};

  const billingMode = String(inv.billing_mode || '').toUpperCase() || 'TP';
  if (!['TP', 'TG'].includes(billingMode)) throw new Error('invoice.billing_mode muss TP oder TG sein');

  const providerGln = assertNonEmpty('provider.gln', prov.gln);
  const providerZsr = String(prov.zsr || '').trim();
  const providerOrg = assertNonEmpty('provider.organization', prov.organization);
  const providerDepartment = String(prov.department || '').trim();
  const providerPostal = buildPostal({
    street: prov.address?.street || '',
    houseNo: prov.address?.houseNo || '',
    zip: prov.address?.zip || '',
    city: prov.address?.city || '',
    country: prov.address?.country || 'CH',
    stateCode: '',
  });
  const providerCompany = buildCompany({
    companyname: providerOrg,
    department: providerDepartment,
    postal: providerPostal,
    phone: prov.contact?.phone || '',
    email: prov.contact?.email || '',
  });

  const patientBirthdate = assertNonEmpty('patient.birthdate', pat.birthdate);
  const patientGender = normalizeGenderXsd(pat.gender || pat.geschlecht);
  if (!patientGender) throw new Error('patient.gender/geschlecht fehlt oder ungültig (male|female|diverse)');
  const patientSex = normalizeSexXsd(pat.sex || pat.treated_sex || pat.billing_sex || (patientGender === 'male' || patientGender === 'female' ? patientGender : null));
  if (!patientSex) throw new Error('patient.sex (male|female) erforderlich (bei diverse: behandeltes Geschlecht setzen)');
  const ahvDigits = digitsOnly(pat.ahv || pat.ahv_nummer || '');
  if (!ahvDigits) throw new Error('patient.ahv fehlt (AHV/SSN erforderlich)');
  if (!/^(\d{4,10}|756\d{10}|438\d{10})$/.test(ahvDigits)) throw new Error('patient.ahv ungültig (SSN/AHV Format)');

  const patientPostal = buildPostal({
    street: pat.address?.street || '',
    houseNo: pat.address?.houseNo || '',
    zip: pat.address?.zip || '',
    city: pat.address?.city || '',
    country: pat.address?.country || 'CH',
  });
  const patientPerson = buildPerson({
    familyname: pat.last_name || pat.nachname || '',
    givenname: pat.first_name || pat.vorname || '',
    postal: patientPostal,
    phone: pat.phone || '',
    email: pat.email || '',
  });

  const insurerGln = ins ? (ins.gln || ins.ean || ins.ean_party || ins.insurance_gln) : '';
  const insurerName = ins ? (ins.name || '') : '';
  const insurerAddressLine = ins ? (ins.address || '') : '';
  const insurerZip = ins ? (ins.zip || parseZipCityFromOneLine(insurerAddressLine).zip || '') : '';
  const insurerCity = ins ? (ins.city || parseZipCityFromOneLine(insurerAddressLine).city || '') : '';

  const lawRaw = String(inv.case?.type || inv.case?.coverage || setl.case_type || '').toUpperCase();
  const law = (() => {
    if (['KVG', 'UVG', 'MVG', 'VVG', 'ORG', 'IVG'].includes(lawRaw)) return lawRaw;
    if (lawRaw === 'IV') return 'IVG';
    if (lawRaw.includes('SELBST') || lawRaw.includes('SELF')) return 'ORG';
    return '';
  })();
  if (!law) throw new Error('invoice.case.type muss KVG/UVG/IV/IVG/MVG/VVG/ORG sein');

  const treatmentCanton = String(inv.case?.canton || setl.canton || '').toUpperCase();
  if (!treatmentCanton) throw new Error('settlement.canton (Kanton Leistungserbringung) fehlt');
  const treatmentReason = (() => {
    const explicit = String(inv.case?.reason || '').trim().toLowerCase();
    if (explicit) return explicit;
    if (law === 'UVG') return 'accident';
    return 'disease';
  })();

  const invoiceId = assertNonEmpty('invoice.id', inv.id);
  const createdAt = inv.created_at || Date.now();
  const requestTimestamp = epochSeconds(createdAt);
  if (!requestTimestamp) throw new Error('invoice.created_at ungültig');

  const payloadCredit = `<invoice:credit request_timestamp="${requestTimestamp}" request_date="${xmlEscape(toISODateTimeMidnight(createdAt))}" request_id="${xmlEscape(invoiceId)}"/>`;
  const payloadInvoice = `<invoice:invoice request_timestamp="${requestTimestamp}" request_date="${xmlEscape(toISODateTimeMidnight(createdAt))}" request_id="${xmlEscape(invoiceId)}"/>`;

  const iban = normalizeIban(prov.qrIban || prov.iban || '');
  if (!iban || !/^(LI|CH)[0-9]{7}[0-9A-Z]{12}$/.test(iban)) throw new Error('provider.iban (CH/LI) fehlt oder ungültig (für QR erforderlich)');
  const payRefType = String(inv.payment_ref?.type || 'NON').toUpperCase();
  const payRefValue = String(inv.payment_ref?.value || '').replace(/\s+/g, '');
  const esrCreditor = `<invoice:creditor>${providerCompany}</invoice:creditor>`;
  const esr = (() => {
    if (payRefType === 'QRR') {
      if (!/^\d{27}$/.test(payRefValue)) throw new Error('payment_ref.value muss 27-stellige QRR-Referenz sein');
      return `<invoice:esrQR iban="${xmlEscape(iban)}" reference_number="${xmlEscape(payRefValue)}" payment_period="P30D">
        ${esrCreditor}
      </invoice:esrQR>`;
    }
    if (payRefType === 'SCOR') {
      if (payRefValue && !/^RF\d{2}[0-9A-Za-z]{1,21}$/.test(payRefValue)) throw new Error('payment_ref.value muss SCOR (RF..) sein');
      return `<invoice:esrQRRed iban="${xmlEscape(iban)}"${payRefValue ? ` reference_number="${xmlEscape(payRefValue)}"` : ''} payment_period="P30D">
        ${esrCreditor}
      </invoice:esrQRRed>`;
    }
    // NON → use esrQRRed without reference_number (optional)
    return `<invoice:esrQRRed iban="${xmlEscape(iban)}" payment_period="P30D">
      ${esrCreditor}
    </invoice:esrQRRed>`;
  })();

  const billers = `<invoice:billers>
    <invoice:biller_gln gln="${xmlEscape(providerGln)}">${providerCompany}</invoice:biller_gln>
    ${providerZsr ? `<invoice:biller_zsr zsr="${xmlEscape(providerZsr)}">${providerCompany}</invoice:biller_zsr>` : ''}
  </invoice:billers>`;

  const providers = `<invoice:providers>
    <invoice:provider_gln gln="${xmlEscape(providerGln)}" gln_location="${xmlEscape(String(prov.gln_location || providerGln))}">${providerCompany}</invoice:provider_gln>
    ${providerZsr ? `<invoice:provider_zsr zsr="${xmlEscape(providerZsr)}">${providerCompany}</invoice:provider_zsr>` : ''}
  </invoice:providers>`;

  const insurance = (() => {
    if (!ins) return '';
    const g = assertNonEmpty('insurer.gln/ean', insurerGln);
    const name = assertNonEmpty('insurer.name', insurerName);
    const postal = buildPostal({ street: '', houseNo: '', zip: insurerZip, city: insurerCity, country: 'CH' });
    const company = buildCompany({ companyname: name, postal });
    return `<invoice:insurance gln="${xmlEscape(g)}">${company}</invoice:insurance>`;
  })();

  const guarantor = `<invoice:guarantor>${patientPerson}</invoice:guarantor>`;

  const patient = `<invoice:patient gender="${xmlEscape(patientGender)}" sex="${xmlEscape(patientSex)}" birthdate="${xmlEscape(toISODateOnly(patientBirthdate))}" ssn="${xmlEscape(ahvDigits)}">
    ${patientPerson}
  </invoice:patient>`;

  const debitor = (() => {
    if (billingMode === 'TP') {
      if (!ins) throw new Error('insurer erforderlich für TP');
      const g = assertNonEmpty('insurer.gln/ean', insurerGln);
      const postal = buildPostal({ street: '', houseNo: '', zip: insurerZip, city: insurerCity, country: 'CH' });
      const company = buildCompany({ companyname: insurerName, postal });
      return `<invoice:debitor gln="${xmlEscape(g)}">${company}</invoice:debitor>`;
    }
    // TG: private debitor without GLN → configured placeholder
    const debGln = assertNonEmpty('billing.debitor_person_gln', defaults.debitor_person_gln);
    return `<invoice:debitor gln="${xmlEscape(debGln)}">${patientPerson}</invoice:debitor>`;
  })();

  const partners = `<invoice:partners/>`;

  const totalAmount = Number(totals.total_chf ?? totals.net_chf ?? 0) || 0;
  const vatAmount = Number(totals.vat_chf ?? 0) || 0;
  const netAmount = Number(totals.net_chf ?? totalAmount - vatAmount ?? 0) || 0;
  const vatRate = (vatAmount > 0 && netAmount > 0) ? Math.round((vatAmount / netAmount) * 10000) / 100 : 0;

  const vat = `<invoice:vat vat="${vatAmount.toFixed(2)}">
    <invoice:vat_rate vat_rate="${vatRate.toFixed(2)}" amount="${totalAmount.toFixed(2)}" vat="${vatAmount.toFixed(2)}"/>
  </invoice:vat>`;

  const balance = billingMode === 'TG'
    ? `<invoice:balance amount="${totalAmount.toFixed(2)}" amount_due="${totalAmount.toFixed(2)}">
        ${vat}
      </invoice:balance>`
    : `<invoice:balance amount="${totalAmount.toFixed(2)}" amount_due="${totalAmount.toFixed(2)}">
        ${vat}
      </invoice:balance>`;

  const tiers = (() => {
    if (billingMode === 'TP') {
      if (!ins) throw new Error('insurer erforderlich für TP');
      return `<invoice:tiers_payant allowModification="${bool01(false)}">
        ${billers}
        ${debitor}
        ${providers}
        ${insurance}
        ${patient}
        ${guarantor}
        ${partners}
        ${balance}
      </invoice:tiers_payant>`;
    }
    // TG
    return `<invoice:tiers_garant>
      ${billers}
      ${debitor}
      ${providers}
      ${ins ? insurance : ''}
      ${patient}
      ${guarantor}
      ${partners}
      ${balance}
    </invoice:tiers_garant>`;
  })();

  const treatmentBegin = services.length ? toISODateOnly(services[0].date || inv.created_at) : toISODateOnly(inv.created_at);
  const treatmentEnd = services.length ? toISODateOnly(services[services.length - 1].date || inv.created_at) : toISODateOnly(inv.created_at);

  const treatment = `<invoice:treatment date_begin="${xmlEscape(treatmentBegin)}" date_end="${xmlEscape(treatmentEnd)}" canton="${xmlEscape(treatmentCanton)}" reason="${xmlEscape(treatmentReason)}"/>`;

  const servicesXml = `<invoice:services>
    ${services.map((s, idx) => {
      const kind = String(s.kind || '').toLowerCase();
      const tariffType = kind === 'pauschale' ? '005' : '007';
      const qty = Number(s.quantity || s.amount || 1) || 1;
      const pv = Number(s.point_value_chf || setl.point_value_chf || 0) || 0;
      const alPts = Number(s.al_points || 0) || 0;
      const tlPts = Number(s.tl_points || 0) || 0;
      const unitMt = alPts * pv;
      const unitTt = tlPts * pv;
      const amountMt = unitMt * qty;
      const amountTt = unitTt * qty;
      const amount = Number(s.amount_chf || (amountMt + amountTt) || 0) || 0;
      const bodyLoc = (() => {
        const lat = String(s.lateralitaet || '').toLowerCase();
        if (lat.includes('links')) return 'left';
        if (lat.includes('rechts')) return 'right';
        if (lat.includes('beide') || lat.includes('bilat')) return 'both';
        return 'none';
      })();
      const name = String(s.text || s.title || s.name || '').trim() || String(s.code || '').trim();
      if (!name) throw new Error(`services[${idx}].text/name fehlt`);
      const dateBegin = toISODateTimeWithOptionalTime(s.date || inv.created_at, s.time || s.service_time || s.time_of_day || s.start_time);
      if (!dateBegin) throw new Error(`services[${idx}].date ungültig`);
      return `<invoice:service_ex record_id="${idx + 1}"
        tariff_type="${xmlEscape(tariffType)}"
        code="${xmlEscape(String(s.code || ''))}"
        ${s.ref_code ? `ref_code="${xmlEscape(String(s.ref_code))}"` : ''}
        name="${xmlEscape(name)}"
        quantity="${qty}"
        date_begin="${xmlEscape(dateBegin)}"
        provider_id="${xmlEscape(providerGln)}"
        responsible_id="${xmlEscape(providerGln)}"
        billing_role="both"
        medical_role="self_employed"
        body_location="${xmlEscape(bodyLoc)}"
        unit_mt="${unitMt.toFixed(2)}"
        unit_factor_mt="1"
        scale_factor_mt="1"
        external_factor_mt="1"
        amount_mt="${amountMt.toFixed(2)}"
        unit_tt="${unitTt.toFixed(2)}"
        unit_factor_tt="1"
        scale_factor_tt="1"
        external_factor_tt="1"
        amount_tt="${amountTt.toFixed(2)}"
        amount="${amount.toFixed(2)}"
        service_attributes="0"
      />`;
    }).join('\n')}
  </invoice:services>`;

  const lawNode = `<invoice:law type="${xmlEscape(law)}"
    ${pat.card_id ? `card_id="${xmlEscape(String(pat.card_id))}"` : ''}
    ${pat.insured_id ? `insured_id="${xmlEscape(String(pat.insured_id))}"` : ''}
  />`;

  const NS = 'http://www.forum-datenaustausch.ch/invoice';
  const effectiveGuid = guid || (claim?.guid || claim?.invoice?.guid) || `guid-${Date.now()}-${Math.random()}`;

  // transport to/from
  const from = providerGln;
  const to = (billingMode === 'TP' && ins) ? assertNonEmpty('insurer.gln/ean', insurerGln) : assertNonEmpty('billing.via_gln', defaults.via_gln);

  return `<?xml version="1.0" encoding="UTF-8"?>
<invoice:request xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xmlns:xenc="http://www.w3.org/2001/04/xmlenc#"
  xmlns:ds="http://www.w3.org/2000/09/xmldsig#"
  xmlns:invoice="${NS}"
  xmlns="${NS}"
  xsi:schemaLocation="${NS} generalInvoiceRequest_500.xsd"
  language="${xmlEscape(language)}"
  modus="${xmlEscape(modus)}"
  guid="${xmlEscape(effectiveGuid)}"
  validation_status="0">
  <invoice:processing>
    <invoice:transport from="${xmlEscape(from)}" to="${xmlEscape(to)}"/>
  </invoice:processing>
  <invoice:payload request_type="invoice" request_subtype="normal">
    ${payloadCredit}
    ${payloadInvoice}
    <invoice:body role="physician" place="practice">
      <invoice:prolog>
        <invoice:generator name="dhpatientsync" version="500"/>
      </invoice:prolog>
      ${tiers}
      ${esr}
      ${lawNode}
      ${treatment}
      ${servicesXml}
    </invoice:body>
  </invoice:payload>
</invoice:request>`;
}

module.exports = {
  buildGeneralInvoice50RequestXML,
};

