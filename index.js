const express = require("express");
const cors = require("cors");
const rateLimit = require("express-rate-limit");
const Groq = require("groq-sdk");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 3001;

// Initialiser Groq
const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY,
});

// Compteur de requêtes
let requestCount = 0;

// Vérifier la clé API
if (!process.env.GROQ_API_KEY) {
  console.error("❌ ERREUR: GROQ_API_KEY manquante");
  process.exit(1);
}

// =======================
// Middlewares
// =======================

// CORS (compatible Render + Netlify)
app.use(cors({
  origin: "*",
  methods: ["GET", "POST"],
}));

app.use(express.json({ limit: "10mb" }));

// Logging
app.use((req, res, next) => {
  console.log(`\n📨 [${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
});

// =======================
// Rate limiting
// =======================

const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  message: { error: "Trop de requêtes. Attendez 60 secondes.", retryAfter: 60 },
  handler: (req, res) => {
    console.log(`🚫 Rate limit atteint pour IP: ${req.ip}`);
    res.status(429).json({ error: "Trop de requêtes. Attendez 60 secondes.", retryAfter: 60 });
  }
});

app.use("/api/analyze", apiLimiter);

// =======================
// Prompt d'analyse
// =======================

const ANALYSIS_PROMPT = `Tu es un expert en analyse de littérature scientifique. Analyse ce document et extrait les informations.

IMPORTANT: Réponds UNIQUEMENT en JSON valide:

{
  "title": "Titre de l'article",
  "authors": ["Auteur 1", "Auteur 2"],
  "abstract": "Résumé en 3-5 phrases",
  "doi": "DOI ou Non spécifié",
  "year": "Année ou Non spécifié",
  "keywords": ["mot1", "mot2", "mot3", "mot4", "mot5"],
  "theme": "Thème principal",
  "themeScore": 0,
  "objectives": ["Objectif 1", "Objectif 2", "Objectif 3"],
  "summary": {
    "problem": "Problème de recherche",
    "method": "Méthodologie",
    "data": "Données utilisées",
    "results": "Résultats principaux"
  },
  "conclusions": ["Conclusion 1", "Conclusion 2"],
  "gaps": ["Limite 1", "Limite 2", "Limite 3"],
  "futurework": ["Travail futur 1", "Travail futur 2"],
  "researchDomain": "Domaine de recherche"
}

DOCUMENT:
`;

// =======================
// Routes
// =======================

// Health check
app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    model: "Groq llama-3.3-70b-versatile",
    requests: requestCount
  });
});

// Analyse endpoint
app.post("/api/analyze", async (req, res) => {
  const startTime = Date.now();
  requestCount++;

  console.log(`\n${"=".repeat(50)}`);
  console.log(`📥 [REQUÊTE #${requestCount}] Analyse avec GROQ`);

  try {
    const { text } = req.body;

    if (!text || text.length < 100) {
      return res.status(400).json({ error: "Texte trop court (min 100 caractères)" });
    }

    const truncatedText = text.length > 30000
      ? text.substring(0, 30000)
      : text;

    const completion = await groq.chat.completions.create({
      messages: [
        {
          role: "user",
          content: ANALYSIS_PROMPT + truncatedText
        }
      ],
      model: "llama-3.3-70b-versatile",
      temperature: 0.3,
      max_tokens: 8192,
    });

    const responseText = completion.choices[0]?.message?.content || "";

    if (!responseText) {
      throw new Error("Réponse vide de GROQ");
    }

    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error("Format JSON invalide");
    }

    const result = JSON.parse(jsonMatch[0]);

    const cleanResult = {
      title: result.title || "Titre non identifié",
      authors: Array.isArray(result.authors) ? result.authors : ["Auteur inconnu"],
      abstract: result.abstract || "Résumé non disponible",
      doi: result.doi || "Non spécifié",
      year: result.year || "Non spécifié",
      keywords: Array.isArray(result.keywords) ? result.keywords : ["Non spécifié"],
      theme: result.theme || "Non classifié",
      themeScore: typeof result.themeScore === "number" ? result.themeScore : 75,
      objectives: Array.isArray(result.objectives) ? result.objectives : ["Non identifié"],
      summary: {
        problem: result.summary?.problem || "Non identifié",
        method: result.summary?.method || "Non identifié",
        data: result.summary?.data || "Non spécifié",
        results: result.summary?.results || "Non identifié"
      },
      conclusions: Array.isArray(result.conclusions) ? result.conclusions : ["Non identifié"],
      gaps: Array.isArray(result.gaps) ? result.gaps : ["Non identifié"],
      futurework: Array.isArray(result.futurework) ? result.futurework : ["Non spécifié"],
      researchDomain: result.researchDomain || "Non classifié"
    };

    const duration = Date.now() - startTime;
    console.log(`✅ Succès en ${duration}ms`);
    console.log(`${"=".repeat(50)}\n`);

    res.json(cleanResult);

  } catch (error) {
    console.error("❌ Erreur:", error.message);

    if (error.status === 429) {
      return res.status(429).json({
        error: "Quota GROQ dépassé. Réessayez plus tard.",
        retryAfter: 60
      });
    }

    res.status(500).json({ error: error.message || "Erreur serveur" });
  }
});

// =======================
// Start server
// =======================

app.listen(PORT, () => {
  console.log(`
🚀 BACKEND SCIENTIFIC ANALYSIS - GROQ
====================================
✅ Port: ${PORT}
✅ Health: GET /api/health
✅ Analyze: POST /api/analyze
====================================
`);
});
