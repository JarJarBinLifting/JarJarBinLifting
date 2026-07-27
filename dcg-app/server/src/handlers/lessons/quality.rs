use serde_json::Value;
use std::collections::{HashMap, HashSet};

#[derive(Debug, Default, PartialEq, Eq)]
pub(super) struct LessonAudit {
    pub warnings: Vec<String>,
}

fn text<'a>(value: &'a Value, key: &str) -> Option<&'a str> {
    value
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
}

fn normalize(value: &str) -> String {
    value
        .chars()
        .flat_map(char::to_lowercase)
        .filter_map(|character| match character {
            'à' | 'â' | 'ä' => Some('a'),
            'ç' => Some('c'),
            'é' | 'è' | 'ê' | 'ë' => Some('e'),
            'î' | 'ï' => Some('i'),
            'ô' | 'ö' => Some('o'),
            'ù' | 'û' | 'ü' => Some('u'),
            'ÿ' => Some('y'),
            character if character.is_alphanumeric() => Some(character),
            _ => Some(' '),
        })
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

fn non_empty_strings(values: Option<&Vec<Value>>, expected: usize) -> bool {
    values.is_some_and(|values| {
        values.len() == expected
            && values
                .iter()
                .all(|value| value.as_str().is_some_and(|text| !text.trim().is_empty()))
    })
}

fn has_source_reference(item: &Value) -> bool {
    item.get("source_ref")
        .and_then(Value::as_object)
        .and_then(|reference| reference.get("extrait"))
        .and_then(Value::as_str)
        .is_some_and(|excerpt| excerpt.trim().chars().count() >= 20)
}

fn invalid(message: impl Into<String>) -> Result<LessonAudit, String> {
    Err(message.into())
}

/// Checks the safety properties that remain meaningful without claiming to
/// verify DCG facts against a source the server has not received. Hard
/// contradictions reject the import; pedagogical thinness is kept as a
/// warning count for the lesson library.
pub(super) fn audit_lesson(
    data: &Value,
    expected_chapter: &str,
    expected_ue: &str,
) -> Result<LessonAudit, String> {
    let mut audit = LessonAudit::default();
    let requires_source_references = data
        .get("prompt_version")
        .and_then(Value::as_i64)
        .is_some_and(|version| version >= 6);
    let mut missing_source_references = 0usize;

    if let Some(chapter) = text(data, "chapitre") {
        if !expected_chapter.trim().is_empty() && normalize(chapter) != normalize(expected_chapter)
        {
            return invalid(format!(
                "La leçon annonce le chapitre « {chapter} », mais l'import vise « {expected_chapter} »"
            ));
        }
    } else {
        audit
            .warnings
            .push("Chapitre source absent : rattachement à vérifier.".into());
    }
    if let Some(ue) = text(data, "ue") {
        if !expected_ue.trim().is_empty() && normalize(ue) != normalize(expected_ue) {
            return invalid(format!(
                "La leçon annonce l'UE {ue}, mais l'import vise {expected_ue}"
            ));
        }
    } else {
        audit
            .warnings
            .push("UE source absente : rattachement à vérifier.".into());
    }
    if text(data, "source").is_none() {
        audit
            .warnings
            .push("Source du chapitre absente : comparer au support avant étude.".into());
    }

    let steps = data
        .pointer("/story/etapes")
        .and_then(Value::as_array)
        .ok_or_else(|| "La leçon ne contient aucune étape".to_string())?;
    let mut covered_steps = HashSet::new();
    for (index, step) in steps.iter().enumerate() {
        for field in [
            "titre_court",
            "contexte_narratif",
            "question_activite",
            "notion",
            "explication",
            "application",
            "a_retenir",
            "question_rappel",
        ] {
            if text(step, field).is_none() {
                return invalid(format!(
                    "Étape {} : champ « {field} » manquant ou vide",
                    index + 1
                ));
            }
        }
        if !matches!(
            text(step, "type_activite"),
            Some("prediction" | "liaison" | "contrefactuel")
        ) {
            return invalid(format!("Étape {} : activité invalide", index + 1));
        }
        if !non_empty_strings(step.get("hypotheses").and_then(Value::as_array), 3)
            || !non_empty_strings(step.get("feedbacks").and_then(Value::as_array), 3)
        {
            return invalid(format!(
                "Étape {} : trois hypothèses et trois feedbacks sont requis",
                index + 1
            ));
        }
        if text(step, "explication").is_some_and(|value| value.len() < 45)
            || text(step, "question_rappel").is_some_and(|value| value.len() < 12)
        {
            audit.warnings.push(format!(
                "Étape {} : explication ou rappel trop bref.",
                index + 1
            ));
        }
    }

    let cards = data
        .get("flashcards")
        .and_then(Value::as_array)
        .ok_or_else(|| "La leçon ne contient aucune flashcard".to_string())?;
    let mut answers_by_question = HashMap::new();
    for (index, card) in cards.iter().enumerate() {
        let (Some(question), Some(answer)) = (text(card, "recto"), text(card, "verso")) else {
            return invalid(format!(
                "Flashcard {} : recto et verso sont requis",
                index + 1
            ));
        };
        let key = normalize(question);
        let normalized_answer = normalize(answer);
        if let Some(previous) = answers_by_question.insert(key, normalized_answer.clone()) {
            if previous != normalized_answer {
                return invalid(format!(
                    "Flashcards contradictoires à l'index {}",
                    index + 1
                ));
            }
        }
        if answer.len() < 24 {
            audit
                .warnings
                .push(format!("Flashcard {} : verso trop court.", index + 1));
        }
        if !has_source_reference(card) {
            if requires_source_references {
                return invalid(format!(
                    "Flashcard {} : source_ref.extrait doit citer un extrait exact du support d'au moins 20 caracteres",
                    index + 1
                ));
            }
            missing_source_references += 1;
        }
        if let Some(step) = card.get("etape").and_then(Value::as_i64) {
            if step > 0 && step <= steps.len() as i64 {
                covered_steps.insert(step as usize);
            } else if step > 0 {
                audit
                    .warnings
                    .push(format!("Flashcard {} : étape {step} inconnue.", index + 1));
            }
        }
    }
    let missing_steps = (1..=steps.len())
        .filter(|step| !covered_steps.contains(step))
        .collect::<Vec<_>>();
    if !missing_steps.is_empty() {
        audit.warnings.push(format!(
            "Notions possiblement sans carte dédiée : étapes {}.",
            missing_steps
                .iter()
                .map(usize::to_string)
                .collect::<Vec<_>>()
                .join(", ")
        ));
    }

    let questions = data
        .pointer("/qcm/questions")
        .and_then(Value::as_array)
        .ok_or_else(|| "La leçon ne contient aucun QCM".to_string())?;
    let mut seen_questions = HashSet::new();
    for (index, question) in questions.iter().enumerate() {
        let Some(prompt) = text(question, "question") else {
            return invalid(format!("QCM {} : énoncé manquant", index + 1));
        };
        let Some(options) = question.get("options").and_then(Value::as_array) else {
            return invalid(format!("QCM {} : options manquantes", index + 1));
        };
        let correct = question.get("correct").and_then(Value::as_i64);
        if !non_empty_strings(Some(options), 4)
            || !correct.is_some_and(|value| (0..4).contains(&value))
        {
            return invalid(format!(
                "QCM {} : quatre options et un index correct valide sont requis",
                index + 1
            ));
        }
        let normalized_options = options
            .iter()
            .filter_map(Value::as_str)
            .map(normalize)
            .collect::<Vec<_>>();
        if normalized_options.iter().collect::<HashSet<_>>().len() != normalized_options.len() {
            return invalid(format!(
                "QCM {} : options identiques, aucun vrai distracteur",
                index + 1
            ));
        }
        if !seen_questions.insert(normalize(prompt)) {
            audit.warnings.push(format!(
                "QCM {} : énoncé très proche d'une question précédente.",
                index + 1
            ));
        }
        if text(question, "explication").is_none() {
            return invalid(format!(
                "QCM {} : justification de la bonne réponse manquante",
                index + 1
            ));
        }
        if text(question, "explication").is_some_and(|value| value.len() < 40) {
            audit
                .warnings
                .push(format!("QCM {} : justification trop courte.", index + 1));
        }
        if !has_source_reference(question) {
            if requires_source_references {
                return invalid(format!(
                    "QCM {} : source_ref.extrait doit citer un extrait exact du support d'au moins 20 caracteres",
                    index + 1
                ));
            }
            missing_source_references += 1;
        }
        if let Some(feedbacks) = question.get("option_feedbacks") {
            if !non_empty_strings(feedbacks.as_array(), 4) {
                return invalid(format!(
                    "QCM {} : quatre feedbacks non vides sont requis",
                    index + 1
                ));
            }
            let distinct_feedbacks = feedbacks
                .as_array()
                .expect("checked above")
                .iter()
                .filter_map(Value::as_str)
                .map(normalize)
                .collect::<HashSet<_>>();
            if distinct_feedbacks.len() != 4 {
                audit.warnings.push(format!(
                    "QCM {} : feedbacks de distracteurs trop proches.",
                    index + 1
                ));
            }
        } else {
            audit.warnings.push(format!(
                "QCM {} : feedback des distracteurs absent.",
                index + 1
            ));
        }
    }

    let story_step_count = steps.len() as i64;
    if let Some(exercises) = data.get("exercices") {
        let Some(exercises) = exercises.as_array() else {
            return invalid("Le champ exercices doit être une liste");
        };
        if exercises.is_empty() {
            audit
                .warnings
                .push("Aucun mini-exercice de simulation déclaré.".into());
        }
        if !exercises.is_empty() && exercises.len() < 4 {
            audit.warnings.push("Moins de quatre mini-exercices : les simulations longues couvriront moins de notions.".into());
        }
        for (index, exercise) in exercises.iter().enumerate() {
            for field in ["titre", "enonce", "consigne", "corrige"] {
                if text(exercise, field).is_none() {
                    return invalid(format!(
                        "Exercice {} : champ « {field} » manquant ou vide",
                        index + 1
                    ));
                }
            }
            if !has_source_reference(exercise) {
                if requires_source_references {
                    return invalid(format!(
                        "Exercice {} : source_ref.extrait doit citer un extrait exact du support d'au moins 20 caracteres",
                        index + 1
                    ));
                }
                missing_source_references += 1;
            }
            if !matches!(
                text(exercise, "format"),
                Some("redaction" | "calcul" | "application")
            ) {
                return invalid(format!("Exercice {} : format invalide", index + 1));
            }
            if !exercise
                .get("duree_minutes")
                .and_then(Value::as_i64)
                .is_some_and(|minutes| (3..=20).contains(&minutes))
            {
                return invalid(format!(
                    "Exercice {} : durée entre 3 et 20 minutes requise",
                    index + 1
                ));
            }
            if !exercise
                .get("notions")
                .and_then(Value::as_array)
                .is_some_and(|notions| {
                    notions.iter().any(|notion| {
                        notion
                            .as_str()
                            .is_some_and(|value| !value.trim().is_empty())
                    })
                })
            {
                return invalid(format!(
                    "Exercice {} : au moins une notion est requise",
                    index + 1
                ));
            }
            let Some(criteria) = exercise.get("bareme").and_then(Value::as_array) else {
                return invalid(format!("Exercice {} : barème manquant", index + 1));
            };
            if criteria.len() < 2 {
                return invalid(format!(
                    "Exercice {} : au moins deux critères de barème sont requis",
                    index + 1
                ));
            }
            for criterion in criteria {
                if text(criterion, "critere").is_none()
                    || text(criterion, "attendu").is_none()
                    || text(criterion, "piege").is_none()
                    || !criterion
                        .get("points")
                        .and_then(Value::as_f64)
                        .is_some_and(|points| points > 0.0)
                {
                    return invalid(format!(
                        "Exercice {} : chaque critère exige points, attendu et piège",
                        index + 1
                    ));
                }
            }
            if let Some(step_refs) = exercise.get("etapes") {
                if !step_refs.as_array().is_some_and(|references| {
                    references.iter().all(|step| {
                        step.as_i64()
                            .is_some_and(|step| step > 0 && step <= story_step_count)
                    })
                }) {
                    audit.warnings.push(format!(
                        "Exercice {} : références d'étapes à vérifier.",
                        index + 1
                    ));
                }
            }
        }
    } else {
        audit
            .warnings
            .push("Aucun mini-exercice de simulation déclaré.".into());
    }

    if missing_source_references > 0 {
        audit.warnings.push(format!(
            "{} element(s) ne sont pas relies a un extrait du support. Regenere avec le prompt v6.",
            missing_source_references
        ));
    }

    Ok(audit)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn lesson() -> Value {
        json!({
            "chapitre": "La TVA", "ue": "UE4", "source": "Support",
            "story": { "etapes": [{
                "titre_court": "TVA", "contexte_narratif": "Un contexte suffisamment détaillé.",
                "type_activite": "prediction", "question_activite": "Quelle règle appliquer ?",
                "hypotheses": ["a", "b", "c"], "feedbacks": ["un", "deux", "trois"],
                "notion": "TVA", "explication": "Une explication suffisamment longue pour franchir le seuil de contrôle.",
                "application": "Application", "a_retenir": "Règle", "question_rappel": "Quelle règle ?"
            }]},
            "flashcards": [{"recto": "TVA ?", "verso": "La réponse attendue est suffisamment détaillée pour être utile.", "etape": 1}],
            "qcm": { "questions": [{
                "question": "Quelle TVA ?", "options": ["A", "B", "C", "D"], "correct": 0,
                "explication": "Cette justification est suffisamment longue pour expliquer la règle appliquée.",
                "option_feedbacks": ["retour un assez long", "retour deux assez long", "retour trois assez long", "retour quatre assez long"]
            }]}
        })
    }

    #[test]
    fn blocks_a_lesson_attached_to_another_chapter() {
        assert!(audit_lesson(&lesson(), "Impôt sur les sociétés", "UE4").is_err());
    }

    #[test]
    fn blocks_duplicate_qcm_options() {
        let mut invalid = lesson();
        invalid["qcm"]["questions"][0]["options"] = json!(["A", "A", "C", "D"]);
        assert!(audit_lesson(&invalid, "La TVA", "UE4").is_err());
    }

    #[test]
    fn blocks_prompt_v6_without_source_references() {
        let mut invalid = lesson();
        invalid["prompt_version"] = json!(6);
        let error = audit_lesson(&invalid, "La TVA", "UE4").unwrap_err();
        assert!(error.contains("source_ref.extrait"));
    }

    #[test]
    fn blocks_an_exercise_without_a_usable_rubric() {
        let mut invalid = lesson();
        invalid["exercices"] = json!([{
            "titre": "Qualifier", "format": "application", "duree_minutes": 8,
            "notions": ["TVA"], "enonce": "Un cas", "consigne": "Répondre", "corrige": "Corrigé",
            "bareme": [{"critere": "Décision", "points": 2, "attendu": "Qualifier", "piege": "Confondre"}]
        }]);
        assert!(audit_lesson(&invalid, "La TVA", "UE4").is_err());
    }

    #[test]
    fn keeps_short_feedback_as_a_warning_not_a_false_fact_check() {
        let mut thin = lesson();
        thin["qcm"]["questions"][0]["explication"] = json!("Trop bref");
        let audit = audit_lesson(&thin, "La TVA", "UE4").unwrap();
        assert!(audit
            .warnings
            .iter()
            .any(|warning| warning.contains("justification trop courte")));
    }
}
