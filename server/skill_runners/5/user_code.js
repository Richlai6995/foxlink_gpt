module.exports = async function handler(body) {
  // For post_answer mode: user_message carries voice preferences, ai_response carries text to synthesize
  const input      = body.user_message || body.content || body.text || body.message || '';
  const rawContent = body.ai_response || input;   // prefer AI response if present (post_answer mode)

  // In post_answer mode: if AI response is substantial but user hasn't specified voice preferences,
  // pause and ask rather than guessing. Return { pending: true } so server stores content for next turn.
  const isPostAnswerMode = !!body.ai_response && body.ai_response.length > 150;
  const hasVoicePref = /男聲|女聲|wavenet|neural2|standard|male|female|英文|越文|日文|韓文|cmn-|en-US|vi-VN|ja-JP|ko-KR/i.test(input);
  if (isPostAnswerMode && !hasVoicePref) {
    return {
      pending: true,
      system_prompt:
        '\n\n---\n🎤 **語音合成準備就緒！** 請回覆您想要的語言和聲音，例如：\n' +
        '- `繁中男聲` / `繁中女聲`\n' +
        '- `英文男聲` / `英文女聲`\n' +
        '- `越南文男聲` / `日文女聲` / `韓文男聲`\n\n' +
        '回覆後系統將自動為您生成語音。',
    };
  }
  const FOXLINK_API = process.env.FOXLINK_API_URL  || `http://localhost:${process.env.PORT || 3001}`;
  const SERVICE_KEY = process.env.SKILL_SERVICE_KEY || 'foxlink-tts-2024';

  const VOICES = {
    'cmn-TW': {
      FEMALE: ['cmn-TW-Wavenet-A', 'cmn-TW-Standard-A'],
      MALE:   ['cmn-TW-Wavenet-B', 'cmn-TW-Wavenet-C', 'cmn-TW-Standard-B'],
    },
    'en-US': {
      FEMALE: ['en-US-Neural2-F', 'en-US-Neural2-C', 'en-US-Wavenet-F', 'en-US-Wavenet-C'],
      MALE:   ['en-US-Neural2-D', 'en-US-Neural2-A', 'en-US-Wavenet-D', 'en-US-Wavenet-A'],
    },
    'vi-VN': {
      FEMALE: ['vi-VN-Wavenet-A', 'vi-VN-Wavenet-C', 'vi-VN-Standard-A', 'vi-VN-Standard-C'],
      MALE:   ['vi-VN-Wavenet-B', 'vi-VN-Wavenet-D', 'vi-VN-Standard-B', 'vi-VN-Standard-D'],
    },
    'ja-JP': {
      FEMALE: ['ja-JP-Neural2-B', 'ja-JP-Wavenet-A'],
      MALE:   ['ja-JP-Neural2-C', 'ja-JP-Wavenet-C'],
    },
    'ko-KR': {
      FEMALE: ['ko-KR-Neural2-A', 'ko-KR-Wavenet-A'],
      MALE:   ['ko-KR-Neural2-C', 'ko-KR-Wavenet-C'],
    },
  };

  function detectLang(t) {
    // Chinese keywords first (unambiguous), then English with word boundary
    if (/英文|英語/.test(t) || /\benglish\b/i.test(t))               return 'en-US';
    if (/越文|越南/.test(t) || /\bvietnamese\b|tiếng việt/i.test(t)) return 'vi-VN';
    if (/日文|日語/.test(t) || /\bjapanese\b/i.test(t))              return 'ja-JP';
    if (/韓文|韓語/.test(t) || /\bkorean\b/i.test(t))               return 'ko-KR';
    return 'cmn-TW';
  }
  function detectGender(t) {
    // Check Chinese keywords first (unambiguous, user intent)
    if (/女聲|女生/.test(t)) return 'FEMALE';
    if (/男聲|男生/.test(t)) return 'MALE';
    // English with word boundaries — prevent "demand","management" matching "man"
    if (/\bfemale\b|\bwoman\b/i.test(t)) return 'FEMALE';
    if (/\bmale\b|\bman\b/i.test(t))     return 'MALE';
    return 'FEMALE';
  }
  function detectSpeed(t) {
    if (/很慢|超慢/i.test(t)) return 0.6;
    if (/慢|slow/i.test(t))   return 0.8;
    if (/很快|超快/i.test(t)) return 1.6;
    if (/快|fast/i.test(t))   return 1.3;
    return 1.0;
  }
  function detectPitch(t) {
    if (/低沉|低音|deep/i.test(t)) return -4.0;
    if (/高亢|高音|high/i.test(t)) return  4.0;
    return 0.0;
  }
  function extractText(t) {
    // 1. Strip command prefix: "把以下文字轉成繁中女聲,語速1x, 內容如下:"
    //    Matches: 把/將/請...內容如下/以下內容/如下/以下 + colon
    const prefixMatch = t.match(/^[\s\S]{0,200}?(?:內容如下|以下內容|內容是|如下)[：:]\s*/);
    if (prefixMatch) {
      t = t.slice(prefixMatch[0].length);
      // Strip surrounding quotes left by the delimiter
      t = t.replace(/^[\s"「『""]+/, '').replace(/[\s"」』""]+$/, '');
    }

    // 2. Short input (< 300 chars) → TTS command mode
    if (t.length < 300) {
      const quoted = t.match(/[「『"]([\s\S]+?)[」』"]/);
      if (quoted) return quoted[1].trim();
      return t.replace(/把|將|轉成|轉為|念出|用.{0,5}(聲|音|語|文)|語速.*|音調.*|男聲|女聲|英文|越文|日文|韓文|快|慢|低沉|高亢/g, '').trim();
    }
    // 3. Long text — strip markdown, URLs, then flatten for TTS
    return t
      .replace(/```[\s\S]*?```/g, '')           // fenced code blocks
      .replace(/`[^`]+`/g, '')                   // inline code
      .replace(/https?:\/\/\S+/g, '')            // URLs (TTS would read them character by character)
      .replace(/^#{1,6}\s+/gm, '')               // markdown headers
      .replace(/\*\*/g, '').replace(/\*/g, '')   // bold/italic
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')   // [text](url) → text
      .replace(/^\|.*\|$/gm, '')                 // table rows
      .replace(/^來源：\S+$/gm, '')              // "來源：https://..." lines
      .replace(/\n/g, '，')                      // newlines → Chinese pause (natural TTS phrasing)
      .replace(/，{2,}/g, '，')                  // collapse multiple commas
      .replace(/\s{2,}/g, ' ')
      .trim();
  }

  // Voice settings from user_message (e.g. "男聲", "英文", "語速快")
  // Text content from ai_response if present, otherwise from user_message
  const explicitVoice = input.match(/\b([a-z]{2,3}-[A-Z]{2}-(?:Neural2|Wavenet|Standard)-[A-Z])\b/);

  const lang      = detectLang(input);
  const gender    = detectGender(input);
  const speed     = detectSpeed(input);
  const pitch     = detectPitch(input);
  const voiceName = explicitVoice ? explicitVoice[1] : VOICES[lang]?.[gender]?.[0];
  const text      = extractText(rawContent);

  console.log('[TTS skill] FOXLINK_API=' + FOXLINK_API + ' PORT=' + process.env.PORT);
  console.log('[TTS skill] input.length=' + input.length + ' extracted.length=' + text.length);
  console.log('[TTS skill] first 200: ' + text.slice(0, 200));

  if (!text || text.length < 1) {
    return {
      system_prompt: [
        '請提供要轉換的文字，例如：',
        '- 把「你好，歡迎使用」轉成繁中女聲',
        '- 把「Hello」轉成英文男聲，語速快一點',
        '- 把「Xin chào」用越南女聲念出來',
        '- 用 cmn-TW-Wavenet-B 念「今天天氣很好」',
      ].join('\n'),
    };
  }

  // Google TTS limit ~5000 bytes UTF-8; Chinese ~3 bytes/char → cap at 1500 chars
  const ttsText = Buffer.byteLength(text, 'utf8') > 4800 ? text.slice(0, 1500) : text;

  let res, data;
  try {
    res = await fetch(FOXLINK_API + '/api/skills/tts/synthesize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-service-key': SERVICE_KEY },
      body: JSON.stringify({ text: ttsText, voice_name: voiceName, speaking_rate: speed, pitch }),
    });
    data = await res.json();
    console.log('[TTS skill] synthesize response: status=' + res.status + ' audio_url=' + (data?.audio_url || 'NONE'));
  } catch (e) {
    console.error('[TTS skill] synthesize fetch failed: ' + e.message);
    return { system_prompt: '連線 TTS 服務失敗：' + e.message };
  }

  if (!res.ok) {
    return { system_prompt: 'TTS 錯誤：' + (data.error || res.status) };
  }

  const audioSrc    = FOXLINK_API + data.audio_url;
  const quality     = voiceName.includes('Neural2') ? 'Neural2 ★★★'
                    : voiceName.includes('Wavenet') ? 'Wavenet ★★☆' : 'Standard ★☆☆';
  const langLabel   = { 'cmn-TW': '繁體中文', 'en-US': '英文', 'vi-VN': '越南文', 'ja-JP': '日文', 'ko-KR': '韓文' }[lang] || lang;
  const genderLabel = gender === 'FEMALE' ? '女聲' : '男聲';

  return {
    system_prompt: '語音合成完成！\n\n' +
      '| 項目 | 設定 |\n|------|------|\n' +
      '| 文字 | ' + ttsText.slice(0, 30) + '… |\n' +
      '| 語言 | ' + langLabel + ' |\n' +
      '| 聲音 | ' + data.voice_used + '（' + genderLabel + '）|\n' +
      '| 品質 | ' + quality + ' |\n' +
      '| 語速 | ' + speed + 'x |\n' +
      '| 音調 | ' + (pitch > 0 ? '+' : '') + pitch + ' |\n\n' +
      '<audio controls src="' + audioSrc + '"></audio>\n\n' +
      '[⬇ 下載 MP3](' + audioSrc + ')',
    audio_url:      data.audio_url,
    voice_used:     data.voice_used,
    language:       lang,
    text_converted: ttsText,
  };
};
