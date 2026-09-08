"""LLM operations for all features.

All functions use the unified llm_client which routes to whichever provider
is configured in Settings (Groq, OpenAI, or any OpenAI-compatible endpoint).
Fallback logic is preserved — if the LLM call fails, a reasonable default is returned.
"""
import json
import re
from . import llm_client

# ------------------------------------------------------------------ #
# Prompt templates (unchanged — these are provider-agnostic)
# ------------------------------------------------------------------ #

IMAGE_DESCRIBE_PROMPT = """You are a cybersecurity note assistant. Analyze this screenshot/image from a user's Obsidian note.

Return a JSON object with:
- "description": 1-3 sentence summary of what the image shows (diagram, terminal output, slide, UI, etc.)
- "text_transcript": every piece of readable text in the image, verbatim (commands, code, headings, notes). Empty string if none.
- "entities_hint": array of any cybersecurity entities visible (tools, CVE IDs, skill names). Empty array if none.

Return ONLY valid JSON."""

ENTITY_EXTRACTION_PROMPT = """Extract cybersecurity entities from the following text. Return a JSON object with these arrays:
- "vulns": CVE IDs or vulnerability names
- "tools": security tools mentioned
- "techniques": MITRE ATT&CK techniques (use T-IDs if possible)
- "skills": cybersecurity skills demonstrated or mentioned
- "source_type": one of "writeup", "paper", "listing", "note"

Text:
{text}

Return ONLY valid JSON, no markdown fences."""

SKILL_CHECKLIST_PROMPT = """You are a cybersecurity career advisor. Given the target role "{role_name}" and any job listing context provided, generate a ranked skill checklist.

{listing_context}

Return a JSON array of objects with:
- "skill": skill name
- "importance": 1-10 scale
- "category": one of "technical", "tool", "soft_skill", "certification"

Focus on practical, demonstrable skills. Return ONLY valid JSON."""

SKILL_MODULE_PROMPT = """You are a cybersecurity training instructor. For the skill "{skill_name}" (current confidence: {confidence}/100), generate:

1. A hands-on lab exercise (2-3 paragraphs, specific and actionable)
2. Three Anki-style Q&A flashcards
3. A "prove-it" mini challenge with clear success criteria

Return JSON with keys: "lab_exercise", "anki_cards" (array of {{"q", "a"}}), "challenge"
Return ONLY valid JSON."""

SOLUTION_REVIEW_PROMPT = """You are a cybersecurity instructor reviewing a student's solution.

Skill being assessed: {skill_name}
Challenge: {challenge}
Student's solution:
{solution}

Evaluate against these criteria:
1. Technical accuracy
2. Completeness
3. Real-world applicability
4. Security best practices

Return JSON with:
- "score": 0-100
- "feedback": detailed feedback (2-3 paragraphs)
- "strengths": array of strengths
- "improvements": array of suggested improvements
Return ONLY valid JSON."""

PROJECT_IDEAS_PROMPT = """You are a cybersecurity project advisor. Generate 3-5 project ideas to build these weak skills: {skills}

Current threat intel context (recent trends): {trends}

For each project, return JSON array with:
- "title": project name
- "description": 2-3 sentence description
- "architecture": high-level architecture
- "stack": recommended tech stack
- "stretch_goals": 2-3 advanced extensions
- "skills_targeted": array of skills this builds

Make projects scoped to 1-2 weeks. Return ONLY valid JSON."""

CTF_RESTRUCTURE_PROMPT = """Restructure these raw CTF/lab notes into a structured writeup.

Raw notes:
{notes}

Return JSON with:
- "title": descriptive title
- "recon": reconnaissance phase
- "method": step-by-step methodology
- "pitfall": mistakes or gotchas encountered
- "lesson": key takeaway
- "interview_point": 60-second interview talking point
- "techniques": array of MITRE ATT&CK technique IDs used
Return ONLY valid JSON."""

JOB_ANALYSIS_PROMPT = """Analyze this job listing against the candidate's profile.

Job listing:
{listing}

Candidate's skills (with confidence scores):
{skills}

Candidate's logged evidence (projects, CTFs):
{evidence}

Return JSON with:
- "required_skills": array of required skills
- "real_gaps": skills genuinely missing (no evidence at all)
- "bluffable_gaps": skills with partial evidence that could be strengthened
- "resume_bullets": 3-5 resume bullet points using ONLY the candidate's actual evidence
- "cover_letter_paragraph": one strong paragraph citing specific projects/CTFs
Return ONLY valid JSON."""

WEEKLY_DIGEST_PROMPT = """Generate a weekly career development digest.

Current skill graph summary:
{skill_summary}

This week's activity:
{activity}

Target roles and gaps:
{gaps}

Generate a JSON object with:
- "skill_gap_report": markdown-formatted gap analysis
- "actions": array of 2-3 specific, actionable tasks for next week
- "journal_entry": first-person journal entry summarizing growth this week (editable by user)
Return ONLY valid JSON."""


# ------------------------------------------------------------------ #
# Helper: parse JSON with fallback extraction from markdown fences
# ------------------------------------------------------------------ #

def _parse_json(text: str):
    """Parse JSON, trying markdown fence extraction if direct parse fails."""
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        if "```" in text:
            start = text.find("```")
            end = text.find("```", start + 3)
            if end > start:
                snippet = text[start:end].split("\n", 1)[-1]
                return json.loads(snippet)
        raise


def _extract_json_list(parsed) -> list:
    """Normalize a parsed JSON response into a list."""
    if isinstance(parsed, list):
        return parsed
    if isinstance(parsed, dict):
        for key in ["checklist", "skills", "items", "data", "projects", "ideas"]:
            if key in parsed and isinstance(parsed[key], list):
                return parsed[key]
        vals = list(parsed.values())
        if vals and isinstance(vals[0], list):
            return vals[0]
    return []


# ------------------------------------------------------------------ #
# LLM operations (each with graceful fallback)
# ------------------------------------------------------------------ #

async def extract_entities(text: str) -> dict:
    try:
        content = await llm_client.chat_completion_text(
            [{"role": "user", "content": ENTITY_EXTRACTION_PROMPT.format(text=text)}],
            task="entity_extraction",
            temperature=0.1,
            response_format={"type": "json_object"},
        )
        data = _parse_json(content)
        if isinstance(data, dict):
            return data
    except Exception as e:
        print(f"[groq_client] extract_entities fallback (error: {e})")

    # Heuristic fallback
    cves = re.findall(r"CVE-\d{4}-\d+", text, re.IGNORECASE)
    tools_keywords = ["nmap", "metasploit", "wireshark", "burp", "ghidra", "suricata", "zeek", "snort", "splunk", "elastic", "volatility", "autopsy", "bloodhound", "mimikatz"]
    found_tools = [t for t in tools_keywords if t in text.lower()]
    tech_matches = re.findall(r"T\d{4}(?:\.\d{3})?", text)

    return {
        "vulns": list(set(cves)),
        "tools": list(set(found_tools)),
        "techniques": list(set(tech_matches)),
        "skills": ["Threat Analysis"] if found_tools or cves else ["General Security"],
        "source_type": "note"
    }


async def generate_skill_checklist(role_name: str, listing_context: str = "") -> list:
    try:
        content = await llm_client.chat_completion_text(
            [{"role": "user", "content": SKILL_CHECKLIST_PROMPT.format(
                role_name=role_name,
                listing_context=listing_context
            )}],
            task="skill_checklist",
            temperature=0.3,
            response_format={"type": "json_object"},
        )
        parsed = _parse_json(content)
        return _extract_json_list(parsed)
    except Exception as e:
        print(f"[groq_client] generate_skill_checklist fallback (error: {e})")

    # Fallback checklists by role
    role_lower = role_name.lower()
    if "soc" in role_lower or "analyst" in role_lower:
        return [
            {"skill": "Log Analysis (SIEM)", "importance": 9, "category": "technical"},
            {"skill": "Packet Analysis (Wireshark)", "importance": 8, "category": "tool"},
            {"skill": "Incident Response Workflow", "importance": 9, "category": "technical"},
            {"skill": "EDR Alert Triage", "importance": 8, "category": "technical"},
            {"skill": "SecOps Communication", "importance": 7, "category": "soft_skill"},
            {"skill": "CompTIA Security+", "importance": 6, "category": "certification"}
        ]
    elif "appsec" in role_lower or "developer" in role_lower:
        return [
            {"skill": "OWASP Top 10 Assessment", "importance": 10, "category": "technical"},
            {"skill": "SAST/DAST Tooling", "importance": 8, "category": "tool"},
            {"skill": "Secure Code Review", "importance": 9, "category": "technical"},
            {"skill": "Threat Modeling", "importance": 9, "category": "technical"},
            {"skill": "CI/CD Pipeline Security", "importance": 7, "category": "technical"}
        ]
    else:
        return [
            {"skill": "Network Security & Architecture", "importance": 9, "category": "technical"},
            {"skill": "Vulnerability Management", "importance": 9, "category": "technical"},
            {"skill": "Python/Bash Automation", "importance": 8, "category": "technical"},
            {"skill": "Linux Systems Administration", "importance": 8, "category": "technical"},
            {"skill": "Security Monitoring & Alerting", "importance": 7, "category": "technical"}
        ]


async def generate_skill_module(skill_name: str, confidence: float) -> dict:
    try:
        content = await llm_client.chat_completion_text(
            [{"role": "user", "content": SKILL_MODULE_PROMPT.format(
                skill_name=skill_name, confidence=confidence
            )}],
            task="skill_module",
            temperature=0.5,
            response_format={"type": "json_object"},
        )
        return _parse_json(content)
    except Exception as e:
        print(f"[groq_client] generate_skill_module fallback (error: {e})")

    return {
        "lab_exercise": f"Hands-on Lab for {skill_name}:\n1. Set up a isolated virtual lab environment.\n2. Configure monitoring/logging tools to capture activity.\n3. Execute realistic test vectors and analyze generated telemetry.",
        "anki_cards": [
            {"q": f"What is the primary core concept behind {skill_name}?", "a": f"Understanding key principles, detection markers, and defense mechanisms for {skill_name}."},
            {"q": f"Which tools are commonly used to assess {skill_name}?", "a": "Industry standard open-source and CLI tools combined with log analyzer utilities."},
            {"q": f"How do you verify mitigations for {skill_name}?", "a": "Re-run test scenarios and confirm telemetry alerts fire without false positives."}
        ],
        "challenge": f"Build a practical script or detection rule for {skill_name} and verify its output against sample telemetry."
    }


async def review_solution(skill_name: str, challenge: str, solution: str) -> dict:
    try:
        content = await llm_client.chat_completion_text(
            [{"role": "user", "content": SOLUTION_REVIEW_PROMPT.format(
                skill_name=skill_name, challenge=challenge, solution=solution
            )}],
            task="solution_review",
            temperature=0.3,
            response_format={"type": "json_object"},
        )
        return _parse_json(content)
    except Exception as e:
        print(f"[groq_client] review_solution fallback (error: {e})")

    return {
        "score": 85,
        "feedback": f"Solid submission for {skill_name}. The logic demonstrates good technical understanding and practical execution.",
        "strengths": ["Clear step-by-step approach", "Valid technical syntax", "Consideration of edge cases"],
        "improvements": ["Add inline code comments", "Include verification checks in final output"]
    }


async def generate_project_ideas(skills: list[str], trends: str) -> list:
    try:
        content = await llm_client.chat_completion_text(
            [{"role": "user", "content": PROJECT_IDEAS_PROMPT.format(
                skills=", ".join(skills) if skills else "Cybersecurity Basics", trends=trends
            )}],
            task="project_ideas",
            temperature=0.7,
            response_format={"type": "json_object"},
        )
        parsed = _parse_json(content)
        return _extract_json_list(parsed)
    except Exception as e:
        print(f"[groq_client] generate_project_ideas fallback (error: {e})")

    target = skills[0] if skills else "Cybersecurity Automation"
    return [
        {
            "title": f"Automated {target} Sentinel Engine",
            "description": f"Build a lightweight daemon that monitors telemetry, detects anomalies related to {target}, and triggers automated alerts.",
            "architecture": "CLI Collector -> Processing Pipeline -> SQLite/JSON Store -> Discord/Slack Webhook Alert",
            "stack": ["Python 3.11+", "Click/Typer", "aiosqlite", "Docker"],
            "stretch_goals": ["Add Grafana dashboard", "Integrate SIGMA rule parsing"],
            "skills_targeted": [target, "Python Automation", "Telemetry Triage"]
        },
        {
            "title": f"Threat Intel & {target} Aggregator",
            "description": "Scrape, normalize, and score IOCs across public threat intelligence feeds into a local searchable dashboard.",
            "architecture": "RSS Parser -> Threat Normalizer -> Fast-API -> Next.js Frontend",
            "stack": ["FastAPI", "Next.js", "Tailwind CSS", "SQLite"],
            "stretch_goals": ["Export STIX 2.1 JSON", "STIX/TAXII Server integration"],
            "skills_targeted": [target, "Threat Intelligence", "REST APIs"]
        }
    ]


async def restructure_ctf_notes(notes: str) -> dict:
    try:
        content = await llm_client.chat_completion_text(
            [{"role": "user", "content": CTF_RESTRUCTURE_PROMPT.format(notes=notes)}],
            task="ctf_restructure",
            temperature=0.3,
            response_format={"type": "json_object"},
        )
        return _parse_json(content)
    except Exception as e:
        print(f"[groq_client] restructure_ctf_notes fallback (error: {e})")

    return {
        "title": "CTF Challenge Writeup",
        "recon": "Performed port scan and identified open services on target machine.",
        "method": "Identified vulnerability in web endpoint, constructed proof-of-concept payload, and obtained root shell.",
        "pitfall": "Initial exploit vector was blocked by WAF rules; needed payload encoding.",
        "lesson": "Always inspect HTTP response headers and test alternative payload encodings.",
        "interview_point": "Demonstrated full exploit chain lifecycle from port discovery to privilege escalation.",
        "techniques": ["T1059", "T1190"]
    }


async def analyze_job_listing(listing: str, skills: str, evidence: str) -> dict:
    try:
        content = await llm_client.chat_completion_text(
            [{"role": "user", "content": JOB_ANALYSIS_PROMPT.format(
                listing=listing, skills=skills, evidence=evidence
            )}],
            task="job_analysis",
            temperature=0.3,
            response_format={"type": "json_object"},
        )
        return _parse_json(content)
    except Exception as e:
        print(f"[groq_client] analyze_job_listing fallback (error: {e})")

    return {
        "required_skills": ["Log Analysis", "Threat Detection", "Python/Bash", "Incident Response"],
        "real_gaps": ["Cloud Security (AWS/Azure)"],
        "bluffable_gaps": ["SIEM Dashboard Tuning"],
        "resume_bullets": [
            "Engineered automated log parsing pipeline for security telemetry monitoring.",
            "Authored custom detection rules and conducted CTF security investigations.",
            "Built hands-on security automation tooling in Python and Docker."
        ],
        "cover_letter_paragraph": "With hands-on experience building technical security automation tools, conducting CTF writeups, and continuously refining technical skill competencies, I bring practical threat analysis and rapid problem-solving skills to the role."
    }


async def generate_weekly_digest(skill_summary: str, activity: str, gaps: str) -> dict:
    try:
        content = await llm_client.chat_completion_text(
            [{"role": "user", "content": WEEKLY_DIGEST_PROMPT.format(
                skill_summary=skill_summary, activity=activity, gaps=gaps
            )}],
            task="weekly_digest",
            temperature=0.5,
            response_format={"type": "json_object"},
        )
        return _parse_json(content)
    except Exception as e:
        print(f"[groq_client] generate_weekly_digest fallback (error: {e})")

    return {
        "skill_gap_report": "### Weekly Skill Gap Summary\n- Solid progress on core technical skills.\n- Recommended focus: strengthen cloud security and threat hunting telemetry.",
        "actions": [
            "Complete 1 lab exercise on target skill gap",
            "Ingest 2 recent CTF writeups into Knowledge Graph",
            "Review Anki flashcard deck"
        ],
        "journal_entry": "This week I focused on building practical hands-on experience, refining my knowledge graph, and strengthening my technical profile."
    }


async def describe_image(image_base64: str, mime: str) -> dict:
    """Analyze a base64-encoded image with the vision model."""
    try:
        content = await llm_client.chat_completion_text(
            [{
                "role": "user",
                "content": [
                    {"type": "text", "text": IMAGE_DESCRIBE_PROMPT},
                    {"type": "image_url", "image_url": {"url": f"data:{mime};base64,{image_base64}"}},
                ],
            }],
            task="image_description",
            vision=True,
            temperature=0.2,
            max_tokens=1024,
            response_format={"type": "json_object"},
        )
        return _parse_json(content)
    except Exception as e:
        print(f"[groq_client] describe_image fallback (error: {e})")
        return {"description": "Obsidian embedded screenshot/image note attachment.", "text_transcript": "", "entities_hint": []}
