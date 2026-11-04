import https from 'node:https';

export function dataBadge(source) {
  const map = { LIVE_SENSOR: { label: 'Live sensor', tone: 'live' }, EXTERNAL_API: { label: 'External API', tone: 'external' }, FARMER_ENTERED: { label: 'Farmer record', tone: 'farmer' }, SIMULATED_SENSOR: { label: 'Simulated sensor', tone: 'demo' }, SIMULATED_WEATHER: { label: 'Simulated weather', tone: 'demo' }, DEMO_MARKET_DATA: { label: 'Demo market data', tone: 'demo' }, DECISION_ENGINE: { label: 'Decision engine', tone: 'engine' } };
  return map[source] || { label: source || 'Unknown source', tone: 'muted' };
}

export function getWeather(data) {
  if (process.env.OPEN_METEO_BASE_URL) {
    // The adapter is deliberately isolated: a verified provider response can replace demo weather without changing decision code.
    return { mode: 'EXTERNAL_API_CONFIGURED', data, note: 'Provider adapter configured but not called in the demo build until coordinates and response mapping are verified.' };
  }
  return { mode: 'SIMULATED_WEATHER', data, note: 'Demonstration forecast; no live provider credentials or verified farm coordinates were supplied.' };
}

export function neuGenExplain({ question, context, language = 'en' }) {
  const configured = Boolean(process.env.NEUGEN_API_URL && process.env.NEUGEN_API_KEY);
  const isMarathi = language === 'mr';
  const lowerQuestion = String(question || '').toLowerCase();
  const answer = isMarathi
    ? question ? (lowerQuestion.includes('पाण') || lowerQuestion.includes('water') ? 'सिंचनापूर्वी पाण्याचा ताळेबंद आणि शेवटची मातीतील ओलावा नोंद तपासा.' : lowerQuestion.includes('नफा') || lowerQuestion.includes('profit') ? 'कमी, अपेक्षित आणि चांगल्या परिस्थितीतील नफा तुलना करा; अंदाजाला हमीचे उत्पन्न समजू नका.' : 'कृती करण्यापूर्वी शिफारसीची कारणे, जोखीम आणि विश्वास पातळी तपासा.') : 'निर्णय इंजिनने स्पष्टीकरणासाठी संरचित शेती माहिती तयार केली आहे.'
    : question ? `Based on the structured farm records, ${lowerQuestion.includes('water') ? 'review the water budget and latest moisture reading before irrigating.' : lowerQuestion.includes('profit') ? 'compare the conservative, expected, and optimistic profit scenarios rather than treating an estimate as guaranteed income.' : 'review the recommendation reasons, risks, and confidence before acting.'}` : 'The decision engine has produced structured results ready for explanation.';
  return {
    mode: configured ? 'NEUGEN_CONFIGURED_PENDING_VERIFICATION' : 'RULE_BASED_FALLBACK',
    label: configured ? (isMarathi ? 'NeuGen adapter सेट आहे; endpoint पडताळणी आवश्यक' : 'NeuGen adapter configured; endpoint verification required') : (isMarathi ? 'नियमाधारित फॉलबॅक — NeuGen चे लाइव्ह अनुमान नाही' : 'Rule-based fallback — not NeuGen inference'),
    answer,
    contextKeys: Object.keys(context || {}),
    guardrail: isMarathi ? 'आकडेवारी जतन केलेल्या नोंदी आणि निर्णय इंजिनमधून येते. हा adapter मोजमाप, अंदाज, किंमत, उत्पादन किंवा नफा बनवत नाही.' : 'Numerical outputs come from stored records and the decision engine. This adapter must not invent readings, forecasts, prices, yields, or profit figures.'
  };
}

export const externalDataContract = {
  weather: 'Open-Meteo or another verified provider; source and update timestamp required',
  market: 'Verified mandi/provider feed; no fake buyer or transaction records',
  schemes: 'Official source link with eligibility marked unconfirmed until checked',
  ai: 'NeuGen endpoint and model must be supplied and verified before claiming live inference'
};
