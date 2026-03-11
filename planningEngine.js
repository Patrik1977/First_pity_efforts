(function attachPlanningEngine(global) {
  const ROUTES = {
    farExam: {
      key: "farExam",
      title: "До экзамена далеко",
      description: "Спокойный набор базы и закрытие пробелов без перегруза.",
      defaults: {
        sessionSize: 12,
        examEverySessions: 6,
        hardFocus: 0.2,
      },
    },
    planned: {
      key: "planned",
      title: "Плановая подготовка",
      description: "Ритмичная работа по темам, ошибкам и регулярным мини-экзаменам.",
      defaults: {
        sessionSize: 18,
        examEverySessions: 4,
        hardFocus: 0.3,
      },
    },
    intensive4w: {
      key: "intensive4w",
      title: "Интенсив за 4 недели",
      description: "Усиление темпа, контроль сложности и частые предметные экзамены.",
      defaults: {
        sessionSize: 24,
        examEverySessions: 3,
        hardFocus: 0.38,
      },
    },
    intensive2w: {
      key: "intensive2w",
      title: "Интенсив за 2 недели",
      description: "Почти ежедневные контрольные сессии и фокус на слабых темах.",
      defaults: {
        sessionSize: 26,
        examEverySessions: 2,
        hardFocus: 0.45,
      },
    },
    revision: {
      key: "revision",
      title: "Повторение перед экзаменом",
      description: "Короткие точечные блоки и финальная стабилизация навыков.",
      defaults: {
        sessionSize: 14,
        examEverySessions: 2,
        hardFocus: 0.34,
      },
    },
  };

  function safePercent(value) {
    return Math.max(0, Math.min(100, Math.round(value * 100)));
  }

  function mean(values) {
    if (!values.length) {
      return 0;
    }
    return values.reduce((acc, value) => acc + value, 0) / values.length;
  }

  function std(values) {
    if (values.length < 2) {
      return 0;
    }
    const avg = mean(values);
    const variance = mean(values.map((value) => (value - avg) ** 2));
    return Math.sqrt(variance);
  }

  function normalizeReadinessInput(input, coverageSummary) {
    if (
      coverageSummary ||
      (input && input.attempted !== undefined) ||
      (input && input.accuracy !== undefined)
    ) {
      return {
        subjectStats: input || {},
        coverageSummary: coverageSummary || {},
        sessions: [],
        questionHistory: {},
        variantStatus: {},
      };
    }

    return {
      subjectStats: (input && input.subjectStats) || {},
      coverageSummary: (input && input.coverageSummary) || {},
      sessions: (input && input.sessions) || [],
      questionHistory: (input && input.questionHistory) || {},
      variantStatus: (input && input.variantStatus) || {},
      subject: (input && input.subject) || "",
      expectedTypes:
        input && Array.isArray(input.expectedTypes) && input.expectedTypes.length
          ? input.expectedTypes
          : null,
    };
  }

  function computeVariantProgress(variantStatus) {
    const items = Object.values(variantStatus || {});
    if (!items.length) {
      return {
        done: 0,
        partial: 0,
        totalTracked: 0,
        completionRatio: 0,
      };
    }

    const done = items.filter((item) => item && item.status === "done").length;
    const partial = items.filter((item) => item && item.status === "partial").length;
    const completionRatio = Math.max(0, Math.min(1, (done + partial * 0.4) / 15));

    return {
      done,
      partial,
      totalTracked: items.length,
      completionRatio,
    };
  }

  function isoWeekKey(date) {
    const utc = new Date(
      Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
    );
    const day = utc.getUTCDay() || 7;
    utc.setUTCDate(utc.getUTCDate() + 4 - day);
    const isoYear = utc.getUTCFullYear();
    const yearStart = new Date(Date.UTC(isoYear, 0, 1));
    const weekNo = Math.ceil(((utc - yearStart) / 86400000 + 1) / 7);
    return `${isoYear}-W${String(weekNo).padStart(2, "0")}`;
  }

  function buildWeekDynamics(sessions) {
    const weeks = {};
    sessions.forEach((session) => {
      const date = new Date(session.endedAt || session.startedAt || Date.now());
      const weekKey = isoWeekKey(date);
      if (!weeks[weekKey]) {
        weeks[weekKey] = {
          attempts: 0,
          correct: 0,
          sessions: 0,
        };
      }
      weeks[weekKey].attempts += Number(session.questionCount || 0);
      weeks[weekKey].correct += Number(session.correct || 0);
      weeks[weekKey].sessions += 1;
    });

    return Object.entries(weeks)
      .map(([week, payload]) => ({
        week,
        sessions: payload.sessions,
        accuracy: payload.attempts ? payload.correct / payload.attempts : 0,
      }))
      .sort((a, b) => (a.week > b.week ? 1 : -1));
  }

  function knownQuestionTypes() {
    return [
      "single-choice",
      "multi-choice",
      "short-text",
      "numeric-input",
      "sequence-order",
      "matching",
      "fill-in-the-blank",
      "extended-answer-lite",
    ];
  }

  function computeFormatCoverageScore(questionHistory, expectedTypesInput, subjectKey) {
    const expectedTypes = new Set(
      Array.isArray(expectedTypesInput) && expectedTypesInput.length
        ? expectedTypesInput
        : knownQuestionTypes(),
    );

    const solvedTypes = new Set();
    Object.values(questionHistory || {}).forEach((item) => {
      if (
        item &&
        item.attempts > 0 &&
        item.type &&
        (!subjectKey || item.subject === subjectKey)
      ) {
        solvedTypes.add(item.type);
      }
    });

    return {
      ratio: expectedTypes.size ? solvedTypes.size / expectedTypes.size : 0,
      solvedTypes,
      expectedTypes,
    };
  }

  function computeHardReadiness(sessions) {
    let hardTotal = 0;
    let hardCorrect = 0;

    (sessions || []).forEach((session) => {
      const hard = session.difficulties && session.difficulties.hard;
      if (!hard) {
        return;
      }
      hardTotal += Number(hard.total || 0);
      hardCorrect += Number(hard.correct || 0);
    });

    return {
      hardTotal,
      hardAccuracy: hardTotal ? hardCorrect / hardTotal : 0,
    };
  }

  function computeReadiness(input, coverageSummary) {
    const payload = normalizeReadinessInput(input, coverageSummary);
    const subjectStats = payload.subjectStats || {};
    const coverage = payload.coverageSummary || {};
    const sessions = payload.sessions || [];

    const accuracy = Number(subjectStats.accuracy || 0);
    const attempted = Number(subjectStats.attempted || 0);
    const noCoverage = Number(coverage.noCoverage || 0);
    const weakCoverage = Number(coverage.weakCoverage || 0);
    const totalTopics = Math.max(1, Number(coverage.totalTopics || 0));

    const recentAccuracies = sessions.slice(-8).map((session) => Number(session.accuracy || 0));
    const stability = recentAccuracies.length > 1 ? Math.max(0, 1 - std(recentAccuracies) * 2.2) : 0.4;

    const { hardTotal, hardAccuracy } = computeHardReadiness(sessions);
    const formatCoverage = computeFormatCoverageScore(
      payload.questionHistory,
      payload.expectedTypes,
      payload.subject,
    );
    const variantProgress = computeVariantProgress(payload.variantStatus);

    if (attempted <= 0) {
      return {
        readinessScore: 0,
        level: "Низкая",
        components: {
          accuracy: 0,
          coverage: 0,
          stability: 0,
          volume: 0,
          hard: 0,
          formats: 0,
          recency: 0,
          variants: 0,
        },
        hardAccuracy: 0,
        hardTotal: 0,
        formatCoverageRatio: 0,
        variantProgress,
        note: "Оценка готовности тренажера (не официальный прогноз ОГЭ).",
      };
    }

    let recencyScore = 0;
    if (sessions.length) {
      const lastDate = new Date(sessions[sessions.length - 1].endedAt || Date.now()).getTime();
      const days = Math.max(0, (Date.now() - lastDate) / (1000 * 60 * 60 * 24));
      recencyScore = Math.max(0, 1 - days / 20);
    }

    const coveragePenalty = (noCoverage * 2 + weakCoverage) / totalTopics;
    const normalizedCoverage = Math.max(0, 1 - coveragePenalty);

    const components = {
      accuracy: accuracy * 33,
      coverage: normalizedCoverage * 12,
      stability: stability * 12,
      volume: Math.min(1, attempted / 280) * 10,
      hard: Math.min(1, hardAccuracy + (hardTotal >= 20 ? 0.15 : 0)) * 10,
      formats: formatCoverage.ratio * 5,
      recency: recencyScore * 3,
      variants: variantProgress.completionRatio * 15,
    };

    const rawScore = Object.values(components).reduce((acc, value) => acc + value, 0);
    const activityFactor =
      Math.min(1, attempted / 160) * (0.5 + 0.5 * Math.min(1, sessions.length / 8));
    const scoreWithActivity = rawScore * (0.35 + 0.65 * activityFactor);

    let cap = 100;
    if (attempted < 20) {
      cap = 20;
    } else if (attempted < 60) {
      cap = 45;
    } else if (attempted < 120) {
      cap = 70;
    }
    if (variantProgress.done === 0 && variantProgress.partial === 0) {
      cap = Math.min(cap, 35);
    }

    const readinessScore = Math.round(Math.max(0, Math.min(cap, scoreWithActivity)));

    let level = "Низкая";
    if (readinessScore >= 80) {
      level = "Высокая";
    } else if (readinessScore >= 60) {
      level = "Средняя";
    }

    return {
      readinessScore: Math.max(0, Math.min(100, readinessScore)),
      level,
      components,
      hardAccuracy,
      hardTotal,
      formatCoverageRatio: formatCoverage.ratio,
      variantProgress,
      note: "Оценка готовности тренажера (не официальный прогноз ОГЭ).",
    };
  }

  function findAvoidedTypes(questionHistory, sessions, subject, expectedTypesInput) {
    const counts = {};
    Object.values(questionHistory || {}).forEach((item) => {
      if (item.subject !== subject) {
        return;
      }
      counts[item.type] = (counts[item.type] || 0) + Number(item.attempts || 0);
    });

    const known =
      Array.isArray(expectedTypesInput) && expectedTypesInput.length
        ? expectedTypesInput.slice()
        : knownQuestionTypes();

    const used = known.filter((type) => counts[type] > 0);
    if (used.length < known.length) {
      return known.filter((type) => !used.includes(type));
    }

    const avg = mean(Object.values(counts));
    return known.filter((type) => counts[type] < avg * 0.45);
  }

  function findStaleWeakTopics(weakTopics) {
    return (weakTopics || []).filter((item) => {
      if (!item.updatedAt) {
        return true;
      }
      const ageDays = (Date.now() - new Date(item.updatedAt).getTime()) / (1000 * 60 * 60 * 24);
      return ageDays >= 9;
    });
  }

  function buildNextActions(payload) {
    const stats = payload.stats || {};
    const route = ROUTES[payload.routeKey] || ROUTES.planned;
    const subject = payload.subject;
    const coverage = payload.coverage || { items: [], summary: {} };
    const expectedTypesBySubject = payload.expectedTypesBySubject || {};
    const expectedTypes = expectedTypesBySubject[subject] || null;

    const weakTopics = (stats.weakTopics || []).filter((item) => item.subject === subject);
    const staleWeak = findStaleWeakTopics(weakTopics);
    const subjectSessions = (stats.sessions || []).filter((session) => session.subject === subject);
    const readiness = computeReadiness({
      subjectStats: (stats.bySubject && stats.bySubject[subject]) || {},
      coverageSummary: coverage.summary || {},
      sessions: subjectSessions,
      questionHistory: stats.questionHistory || {},
      variantStatus: (stats.variantStatus && stats.variantStatus[subject]) || {},
      subject,
      expectedTypes,
    });

    const actions = [];

    if (weakTopics.length) {
      const weakest = weakTopics.slice().sort((a, b) => a.accuracy - b.accuracy)[0];
      actions.push({
        type: "weak-topic",
        title: `Повторить слабую тему: ${weakest.segment} · ${weakest.topic}`,
        mode: "topic",
        questions: Math.max(10, route.defaults.sessionSize - 2),
        reason: `Точность ${safePercent(weakest.accuracy || 0)}%. Целевой порог: 80%+`,
      });
    }

    const uncovered = (coverage.items || []).filter((item) => item.status === "нет" || item.status === "слабое");
    if (uncovered.length) {
      const first = uncovered[0];
      actions.push({
        type: "coverage-gap",
        title: `Закрыть тему покрытия: ${first.section} · ${first.topic}`,
        mode: "topic",
        questions: Math.max(12, route.defaults.sessionSize),
        reason: `Статус покрытия: ${first.status}.`,
      });
    }

    if (staleWeak.length) {
      const item = staleWeak[0];
      actions.push({
        type: "stale-weak",
        title: `Вернуться к теме, давно не повторявшейся: ${item.topic}`,
        mode: "mistakes",
        questions: 10,
        reason: "Слабая тема не повторялась более 9 дней.",
      });
    }

    const avoidedTypes = findAvoidedTypes(
      stats.questionHistory || {},
      subjectSessions,
      subject,
      expectedTypes,
    );
    if (avoidedTypes.length) {
      actions.push({
        type: "formats",
        title: "Отработать недопредставленные форматы",
        mode: "topic",
        questions: 8,
        reason: `Редко решаемые типы: ${avoidedTypes.slice(0, 3).join(", ")}`,
      });
    }

    const examSessions = subjectSessions.filter((session) => session.mode === "exam");
    const shouldExam =
      subjectSessions.length === 0 || subjectSessions.length % route.defaults.examEverySessions === 0;

    if (shouldExam) {
      actions.push({
        type: "exam-exact",
        title: "Пройти точный экзаменационный макет",
        mode: "exam-exact",
        questions: Math.max(15, Math.min(30, route.defaults.sessionSize)),
        reason: "Регулярная контрольная сессия по маршруту подготовки.",
      });
    } else if (examSessions.length < Math.ceil(subjectSessions.length / route.defaults.examEverySessions)) {
      actions.push({
        type: "exam-train",
        title: "Сделать экзаменационную тренировку",
        mode: "exam-training",
        questions: Math.max(15, Math.min(28, route.defaults.sessionSize)),
        reason: "Нужно поддерживать устойчивость в экзаменационном режиме.",
      });
    }

    if (readiness.readinessScore < 60) {
      actions.push({
        type: "short-fix",
        title: "Короткий блок по ошибкам (10 задач)",
        mode: "mistakes",
        questions: 10,
        reason: "Готовность ниже целевого диапазона. Нужна быстрая стабилизация навыков.",
      });
    }

    return actions.slice(0, 6);
  }

  function buildParentReport(payload) {
    const stats = payload.stats || {};
    const coverageBySubject = payload.coverageBySubject || {};
    const subjects = payload.subjects || [];
    const expectedTypesBySubject = payload.expectedTypesBySubject || {};

    const reportBySubject = subjects.map((subject) => {
      const subjectStats = (stats.bySubject && stats.bySubject[subject.key]) || null;
      const sessions = (stats.sessions || []).filter((session) => session.subject === subject.key);
      const weakTopics = (stats.weakTopics || []).filter((item) => item.subject === subject.key);
      const staleTopics = findStaleWeakTopics(weakTopics);
      const coverageSummary = (coverageBySubject[subject.key] && coverageBySubject[subject.key].summary) || {
        noCoverage: 0,
        weakCoverage: 0,
        totalTopics: 0,
      };

      const tail = sessions.slice(-5);
      const prev = sessions.slice(-10, -5);
      const tailAccuracy = tail.length
        ? tail.reduce((acc, session) => acc + (session.accuracy || 0), 0) / tail.length
        : 0;
      const prevAccuracy = prev.length
        ? prev.reduce((acc, session) => acc + (session.accuracy || 0), 0) / prev.length
        : 0;

      const readiness = computeReadiness({
        subjectStats,
        coverageSummary,
        sessions,
        questionHistory: stats.questionHistory || {},
        variantStatus: (stats.variantStatus && stats.variantStatus[subject.key]) || {},
        subject: subject.key,
        expectedTypes: expectedTypesBySubject[subject.key] || null,
      });

      return {
        subject: subject.key,
        title: subject.title,
        sessions: sessions.length,
        attempted: (subjectStats && subjectStats.attempted) || 0,
        accuracy: (subjectStats && subjectStats.accuracy) || 0,
        weakTopics: weakTopics.length,
        staleTopics: staleTopics.length,
        dynamics: tailAccuracy - prevAccuracy,
        readiness,
        coverageSummary,
        weekly: buildWeekDynamics(sessions),
      };
    });

    return {
      generatedAt: new Date().toISOString(),
      bySubject: reportBySubject,
    };
  }

  global.PlanningEngine = {
    ROUTES,
    buildNextActions,
    buildParentReport,
    computeReadiness,
  };
})(window);
