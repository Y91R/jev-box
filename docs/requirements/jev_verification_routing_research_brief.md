# Jev as a Verification & Routing Layer for AI-Assisted Requirements and Planning

## 1. Цель исследования

Исследовать и спроектировать применение **Jev / System One model** как дешёвого, быстрого и вероятностного слоя верификации и маршрутизации внутри AI-assisted software development workflow.

Основная гипотеза:

> Jev не должен заменять Claude, Codex или человека. Его роль — дешёво определять, есть ли проблема в артефакте, какого она типа, насколько высока уверенность и какой следующий тип reasoning/work необходим.

Целевой сценарий — работа с:

- системными требованиями;
- техническими требованиями;
- архитектурными решениями;
- implementation plans;
- AI-generated plans перед исполнением;
- результатами реализации;
- second-opinion routing между Claude и Codex.

---

# 2. Основная идея

Вместо постоянного вызова нескольких дорогих reasoning-моделей строится control plane:

```text
              Artifact / Task
                    │
                    ▼
               ┌─────────┐
               │   JEV   │
               │ VERIFY  │
               └────┬────┘
                    │
          probabilistic signals
                    │
        ┌───────────┼───────────┐
        ▼           ▼           ▼
     Claude       Codex        Human
    semantic      reality      decision
    reasoning     / repo       / policy
```

Jev отвечает не на вопрос:

> «Как правильно решить задачу?»

а на вопросы:

- Есть ли проблема?
- Какого она типа?
- Насколько сигнал сильный?
- Нужен ли второй взгляд?
- Кто должен выполнить следующий reasoning step?
- Можно ли продолжать автоматически?
- Нужно ли остановиться и привлечь человека?

---

# 3. Роли компонентов

## Jev

Основная роль:

> Probabilistic verifier + router.

Jev должен выполнять узкие атомарные проверки:

- ambiguity detection;
- specificity;
- internal consistency;
- completeness;
- unsupported assumptions;
- likelihood of semantic drift;
- likelihood of repository dependency;
- architecture impact;
- product/business decision detection;
- confidence / escalation signals.

Jev не должен:

- переписывать большие документы;
- самостоятельно проектировать всю систему;
- заменять проверку реального repository;
- принимать продуктовые решения;
- быть финальным источником истины.

---

## Claude

Основная роль:

> Semantic / system reasoning.

Типовые задачи:

- интерпретация исходной задачи;
- разработка и ревизия требований;
- проверка соответствия требованиям источнику;
- поиск semantic drift;
- архитектурный reasoning;
- выявление системных инвариантов;
- заполнение бизнес- и системных пробелов;
- уточнение acceptance criteria;
- разрешение неоднозначностей высокого уровня.

Ключевой вопрос Claude:

> «Правильно ли мы поняли смысл и систему?»

---

## Codex

Основная роль:

> Reality / implementation verifier.

Типовые задачи:

- исследование repository;
- проверка существующих API;
- проверка сервисов, схем, consumers, events;
- поиск реальных extension points;
- проверка feasibility implementation plan;
- выявление migration / compatibility impact;
- поиск скрытых code dependencies;
- проверка тестов и существующих инвариантов.

Ключевой вопрос Codex:

> «Соответствует ли предложение реальному коду и можно ли его так реализовать?»

---

## Human

Основная роль:

> Authority for choices, policy and unresolved ambiguity.

Human должен подключаться, если требуется:

- продуктовый выбор;
- изменение бизнес-семантики;
- решение между несколькими допустимыми вариантами;
- принятие риска;
- изменение policy;
- разрешение фундаментальной неоднозначности исходной задачи.

Ключевой вопрос Human:

> «Какое решение мы хотим принять?»

---

# 4. Главный verifier

Базовая модель качества Requirement / Plan:

```text
                    ARTIFACT
                       │
                       ▼
                 ┌───────────┐
                 │    JEV    │
                 └─────┬─────┘
                       │
       ┌───────────────┼────────────────┐
       ▼               ▼                ▼
 SPECIFICITY       CORRECTNESS      COMPLETENESS
       │               │                │
       │       ┌───────┼────────┐       │
       │       ▼       ▼        ▼       │
       │     logic   source   reality   │
       │       │       │        │       │
       │      Jev    Claude    Codex    │
       │                               │
       └────► Claude          ┌────────┴──────┐
                             ▼               ▼
                           Claude           Codex
                         semantic         technical
                           gaps             gaps

                               │
                               ▼
                      unresolved decision?
                               │
                        ┌──────┴──────┐
                       no            yes
                       │              │
                       ▼              ▼
                    CONTINUE         HUMAN
```

---

# 5. Specificity

## Вопрос

> Можно ли однозначно понять, что требуется сделать и как проверить результат?

Specificity не означает correctness.

Пример:

```text
Система должна быстро возвращать пользователю деньги.
```

Проблемы:

- «быстро» не измеримо;
- нет точки отсчёта;
- нет критерия завершения;
- нет поведения при ошибке;
- два разработчика могут реализовать требование по-разному.

Пример после уточнения:

```text
При успешной отмене заказа система должна инициировать
возврат платежа не позднее 30 секунд после перехода
заказа в состояние CANCELLED.
```

Это конкретно.

Но значение `30 секунд` ещё может быть неправильным или выдуманным.

Поэтому:

```text
Specificity ≠ Correctness
```

## Возможные Jev signals

- specificity;
- ambiguity;
- verifiability;
- measurable_conditions_present;
- actor_defined;
- trigger_defined;
- outcome_defined;
- failure_behavior_defined.

## Routing

Если specificity низкая:

```text
Jev
 ↓
Claude
 ↓
rewrite for specificity without changing semantics
```

---

# 6. Correctness

Correctness необходимо разделить минимум на три независимых вида.

```text
                 CORRECTNESS
                      │
          ┌───────────┼───────────┐
          ▼           ▼           ▼
        LOGIC        SOURCE      REALITY
```

---

## 6.1 Logic correctness

### Вопрос

> Не противоречит ли документ сам себе?

Пример:

```text
REQ-1
Оплаченный заказ можно отменить до передачи курьеру.

REQ-7
После создания доставки оплаченный заказ отменить невозможно.

REQ-9
Доставка создаётся сразу после успешной оплаты.
```

Потенциально присутствует внутреннее противоречие.

### Jev role

Jev может дешёво проверять:

- internal consistency;
- contradiction likelihood;
- mutually exclusive rules;
- incompatible state transitions;
- inconsistent definitions;
- conflicting constraints.

Пример сигналов:

```text
internal_consistency: 0.31
contradiction_present: 0.87
```

Если сигнал сильный — отправить проблему на targeted revision.

---

## 6.2 Source correctness

### Вопрос

> Соответствует ли артефакт исходной задаче и не изменил ли её смысл?

Source — это:

- feature request;
- Jira / Linear issue;
- product brief;
- ADR;
- пользовательское требование;
- решение архитектора;
- бизнес-правило;
- исходное сообщение заказчика.

Пример source:

```text
Пользователь может отменить заказ,
пока заказ не передан в доставку.
```

Artifact:

```text
Пользователь может отменить заказ
в течение 30 минут после оплаты.
```

Artifact очень конкретный, но ограничение `30 минут` не следует из source.

Это semantic drift / unsupported assumption.

### Jev role

Jev может дать initial signals:

- source_alignment;
- semantic_drift;
- unsupported_assumption;
- omitted_constraint;
- strengthened_requirement;
- weakened_requirement.

### Claude role

Если alignment сомнителен, Claude получает targeted verification task:

```text
SOURCE:
<original input>

ARTIFACT:
<generated requirement / plan>

TASK:
Найди места, где artifact:
- изменяет смысл source;
- добавляет неподтверждённые правила;
- теряет исходные ограничения;
- делает более сильные предположения;
- делает требования слабее исходной задачи.

Не переписывай документ целиком.
Верни только расхождения и их последствия.
```

---

## 6.3 Reality correctness

### Вопрос

> Соответствует ли артефакт реальной существующей системе?

Пример plan:

```text
Для возврата вызвать:

PaymentService.refund(order.paymentId)
```

Но в repository:

```text
PaymentService.refund()
```

не существует.

Реальный flow может быть:

```text
RefundOrchestrator.createRefund(...)
```

### Codex role

Codex проверяет:

- существует ли API;
- существует ли сервис;
- существует ли поле / event / schema;
- соответствует ли state machine реальному коду;
- есть ли заявленный extension point;
- какие реальные consumers будут затронуты;
- нужна ли migration;
- нарушается ли backward compatibility;
- существуют ли tests / fixtures / constraints, противоречащие плану.

### Routing

```text
Jev:
implementation_dependency high
or
unsupported_repository_assumption high

        ↓

Codex:
targeted repository verification
```

Codex не должен заново проектировать решение, если задача — только проверить фактические предположения.

---

# 7. Completeness

## Вопрос

> Всё ли необходимое учтено для безопасной реализации и проверки?

Requirement может быть одновременно:

```text
specific = yes
correct = yes
complete = no
```

Пример:

```text
Пользователь может отменить заказ до передачи курьеру.
После отмены инициируется возврат.
```

Потенциально отсутствуют:

- refund failure;
- retry / idempotency;
- повторный cancel;
- race `cancel ↔ courier handoff`;
- inventory reservation;
- delivery cancellation;
- user-visible state;
- audit event;
- notification;
- observability;
- rollback / compensation behavior.

## Jev signals

- failure_behavior_covered;
- concurrency_covered;
- rollback_covered;
- observability_covered;
- security_covered;
- state_transition_covered;
- external_dependency_covered;
- idempotency_covered;
- acceptance_criteria_covered.

## Routing

Пробел семантический / бизнесовый:

```text
→ Claude
```

Пробел технический / repository-dependent:

```text
→ Codex
```

Нужно сделать продуктовый выбор:

```text
→ Human
```

---

# 8. Actionability

Рекомендуется добавить четвёртую верхнеуровневую ось:

```text
ACTIONABILITY
```

## Вопрос

> Можно ли по этому артефакту безопасно начать работу без дополнительных скрытых решений?

Plan может быть конкретным, корректным и полным, но всё ещё не actionable, если:

- не определён порядок действий;
- зависимости между шагами не указаны;
- неизвестен owner;
- нет entry / exit criteria;
- нет критериев завершения;
- нет rollback point;
- есть unverified prerequisite;
- смешаны обязательные и опциональные шаги.

Возможные сигналы:

- executable_without_clarification;
- step_dependencies_defined;
- completion_criteria_defined;
- prerequisites_verified;
- rollback_path_defined;
- hidden_decision_required.

---

# 9. Пример оценки одного требования

Artifact:

```text
После отмены система должна вызвать PaymentService.refund()
в течение 30 секунд.
```

Проверка:

```text
SPECIFICITY
→ высокая

LOGIC CORRECTNESS
→ возможно высокая

SOURCE CORRECTNESS
→ неизвестно, откуда взялись 30 секунд

REALITY CORRECTNESS
→ нужно проверить существование PaymentService.refund()

COMPLETENESS
→ не определено поведение при refund failure
```

Пример structured result:

```json
{
  "specificity": 0.98,
  "internal_consistency": 0.93,
  "source_alignment": 0.42,
  "repository_alignment": 0.11,
  "completeness": 0.57,
  "unsupported_assumption": 0.84
}
```

Главное:

> Нельзя сводить всё к одной оценке `quality = 7/10`.

Для orchestration полезны независимые сигналы, потому что разные проблемы требуют разных следующих действий.

---

# 10. Claude → Jev → Codex

Один из основных workflow.

```text
Feature request
      │
      ▼
   Claude
      │
      ├─ system requirements
      ├─ acceptance criteria
      └─ high-level implementation plan
      │
      ▼
     Jev
      │
      ├─ specificity
      ├─ completeness
      ├─ unsupported assumptions
      ├─ repository dependency
      └─ architecture impact
      │
      ├── semantic issue ─────► Claude
      │
      ├── repository issue ───► Codex
      │
      ├── product decision ───► Human
      │
      └── pass ───────────────► Continue
```

Пример:

```text
depends_on_existing_code = 0.94
```

Routing:

```text
→ invoke Codex
```

Codex получает не общую задачу, а targeted mission:

```text
Проверь proposed implementation plan против реального repository.

Особенно проверь:

- существуют ли указанные abstractions;
- совпадают ли API;
- существуют ли предполагаемые extension points;
- есть ли скрытые зависимости;
- потребуется ли migration;
- потребуется ли backward compatibility handling.

Не переписывай требования.
Верни только найденные расхождения и evidence.
```

---

# 11. Codex → Jev → Claude

Обратный workflow.

```text
Codex
  │
  ├─ inspect repo
  └─ implementation plan
  │
  ▼
 Jev
  │
  ├─ cross_service_impact
  ├─ public_api_change
  ├─ business_rule_change
  ├─ architecture_decision_required
  └─ product_decision_required
```

Если:

```text
cross_service_impact high
or
business_rule_change high
or
architecture_decision_required high
```

то план передаётся Claude для system-level review.

Claude получает:

```text
Не исследуй repository заново.

Codex исследовал кодовую базу и предлагает изменение X.

Проверь:

- соответствует ли решение исходной цели;
- не меняет ли оно бизнес-семантику;
- сохранены ли системные инварианты;
- нужны ли дополнительные системные требования;
- нужны ли дополнительные acceptance criteria;
- содержит ли план архитектурное решение, которое нельзя принимать локально.
```

---

# 12. Independent second opinion

Для high-risk задач можно запускать Claude и Codex независимо.

```text
                  task
             ┌─────┴─────┐
             ▼           ▼
          Claude        Codex
             │           │
             └─────┬─────┘
                   ▼
                  Jev
                   │
            disagreement?
            /           \
          no             yes
          │               │
       continue      classify type
                          │
              ┌───────────┼────────────┐
              ▼           ▼            ▼
      repository fact  architecture  requirement
              │           │            │
            Codex       Claude        Human /
                                     Claude
```

Jev не должен выбирать «кто прав».

Он должен классифицировать природу расхождения.

Пример:

```json
{
  "disagreement": {
    "type": "choice",
    "criteria": {
      "none": "Выводы совместимы",
      "repository_fact": "Спор касается факта существующей реализации",
      "architecture": "Спор касается design choice",
      "requirements": "Спор вызван неоднозначностью требований",
      "business": "Необходим продуктовый или бизнес-выбор"
    }
  }
}
```

Routing:

```text
repository_fact → Codex / repository tools
architecture    → Claude
requirements    → Claude / requirement owner
business        → Human
```

---

# 13. Jev как requirements linter

Возможен CI-like workflow.

При изменении:

```text
requirements.md
```

запускается Jev verifier.

Пример signals:

```text
specificity              0.93
verifiability            0.88
ambiguity                0.17
failure_behavior         0.41
rollback_strategy        0.12
data_ownership           0.96
requires_arch_review     0.71
requires_security_review 0.08
```

Routing:

```text
rollback_strategy low
        ↓
Claude targeted revision

requires_arch_review high
        ↓
architecture review

requires_security_review high
        ↓
security review
```

Цель — заменить один общий prompt:

```text
"Проверь документ и скажи всё, что думаешь"
```

на статически определённый review protocol.

---

# 14. Jev как pre-execution plan gate

Перед тем как AI-agent начнёт менять repository:

```text
Implementation Plan
        │
        ▼
       Jev
```

Проверки:

- modifies_public_contract;
- touches_persistent_schema;
- rollback_difficult;
- assumes_unverified_api;
- steps_independent;
- requires_product_decision;
- requires_architecture_decision;
- touches_security_boundary;
- cross_service_change;
- irreversible_operation.

Пример:

```text
requires_product_decision = 0.89
```

Действие:

```text
STOP
 ↓
Human
```

Agent не должен автоматически продолжать реализацию.

---

# 15. Предлагаемый end-to-end pipeline

```text
User / PM / Issue
       │
       ▼
     Claude
requirements draft
       │
       ▼
     JEV #1
requirements verifier
       │
       ├─ ambiguity ─────────────► Claude revise
       ├─ low specificity ───────► Claude revise
       ├─ semantic drift ────────► Claude source review
       ├─ product decision ──────► Human
       └─ pass
            │
            ▼
          Codex
     inspect repository
     + implementation plan
            │
            ▼
          JEV #2
        plan verifier
            │
            ├─ repo assumption ─────► Codex investigate
            ├─ system impact ───────► Claude architect
            ├─ product decision ────► Human
            ├─ low actionability ───► plan revision
            └─ pass
                  │
                  ▼
              IMPLEMENT
                  │
                  ▼
               TESTS
                  │
                  ▼
               JEV #3
           post-implementation
               verifier
                  │
                  ├─ requirement drift
                  ├─ plan drift
                  ├─ missing acceptance evidence
                  ├─ unresolved assumption
                  └─ unexpected scope expansion
```

---

# 16. Suggested Jev question set for MVP

Необходимо исследовать точный API / типы Jev и адаптировать схему под актуальную версию SDK.

Концептуально MVP должен иметь такие независимые signals.

## Requirements verifier

```text
specificity
ambiguity
verifiability
internal_consistency
source_alignment
unsupported_assumption
completeness
failure_behavior_covered
product_decision_required
architecture_decision_required
repository_dependency
```

## Plan verifier

```text
actionability
unverified_prerequisite
repository_assumption
public_contract_change
persistent_schema_change
cross_service_impact
rollback_difficulty
security_boundary_change
product_decision_required
architecture_decision_required
```

## Post-implementation verifier

```text
requirements_alignment
plan_alignment
scope_drift
acceptance_criteria_covered
unresolved_assumption
unexpected_behavior_change
```

---

# 17. Routing policy

Необходимо не позволять модели напрямую определять действие.

Jev выдаёт probabilistic signals.

Детерминированный orchestration code определяет routing.

Пример:

```python
if product_decision_required > 0.75:
    stop_and_request_human()

elif repository_dependency > 0.75:
    invoke_codex_repository_review()

elif source_alignment < 0.65:
    invoke_claude_source_review()

elif specificity < 0.70:
    invoke_claude_specificity_revision()

elif architecture_decision_required > 0.75:
    invoke_claude_architecture_review()

else:
    continue_pipeline()
```

Thresholds должны быть исследованы и откалиброваны эмпирически.

Не считать эти значения production defaults.

---

# 18. Важный принцип: targeted escalation

При escalation нельзя отправлять другой модели весь workflow с инструкцией:

```text
"Проверь всё заново"
```

Вместо этого Jev должен создавать узкий routing reason.

Пример:

```json
{
  "route": "codex",
  "reason": "repository_assumption",
  "target": [
    "PaymentService.refund",
    "OrderStatus.CANCELLED"
  ]
}
```

И Codex получает узкую задачу:

```text
Проверь только следующие assumptions:

1. Существует ли PaymentService.refund?
2. Существует ли OrderStatus.CANCELLED?
3. Какие реальные зависимости затрагивает их изменение?

Верни evidence и расхождения.
Не перепроектируй feature.
```

Преимущества:

- ниже стоимость;
- меньше drift;
- меньше повторной работы;
- проще анализировать причины escalation;
- проще собирать eval dataset.

---

# 19. Research questions

Перед реализацией необходимо исследовать следующее.

## Jev / TypeSafe

1. Какой текущий API Jev?
2. Какие primitives доступны?
3. Как возвращаются probability / confidence?
4. Есть ли batch questions?
5. Насколько вопросы действительно независимы?
6. Есть ли structured schema / typed output?
7. Какова latency одного request?
8. Какова стоимость batch verification относительно Claude/Codex?
9. Есть ли rate limits?
10. Есть ли caching?
11. Есть ли рекомендованный способ calibration?
12. Есть ли eval tooling?
13. Есть ли examples для verification / guardrails / routing?
14. Можно ли использовать state размером с requirements document?
15. Какие ограничения контекста?
16. Как лучше проверять набор отдельных requirements: одним state или per-item?
17. Как обрабатывать confidence threshold?

## Claude

1. Как лучше передавать targeted review mission?
2. Есть ли смысл разделять:
   - requirements reviewer;
   - architecture reviewer;
   - source alignment reviewer?
3. Нужно ли использовать один system prompt или разные роли?
4. Как возвращать evidence / findings в structured form?

## Codex

1. Как дать Codex repository-aware targeted verification?
2. Как возвращать:
   - verified;
   - contradicted;
   - unknown;
   для каждого assumption?
3. Как прикладывать file / symbol evidence?
4. Как не позволять Codex перепроектировать задачу без необходимости?

## Orchestration

1. Какие thresholds нужны для каждого signal?
2. Какие ошибки опаснее:
   - false positive escalation;
   - false negative pass?
3. Какие gates должны блокировать pipeline?
4. Какие gates могут быть advisory?
5. Какие signals необходимо логировать?
6. Как воспроизводить routing decision?
7. Как измерять экономию token / latency / cost?

---

# 20. MVP

Цель MVP:

> Проверять AI-generated requirement или implementation plan и автоматически решать, нужен ли дополнительный Claude review, Codex repository review или Human escalation.

## MVP input

```json
{
  "artifact_type": "requirement | implementation_plan",
  "source": "...",
  "artifact": "...",
  "constraints": "...",
  "known_system_context": "..."
}
```

## MVP output

```json
{
  "signals": {
    "specificity": 0.0,
    "ambiguity": 0.0,
    "internal_consistency": 0.0,
    "source_alignment": 0.0,
    "completeness": 0.0,
    "repository_dependency": 0.0,
    "product_decision_required": 0.0,
    "architecture_decision_required": 0.0
  },

  "routing": {
    "target": "continue | claude | codex | human",
    "reason": "...",
    "blocking": true
  }
}
```

Важно:

`routing` в финальной реализации желательно вычислять orchestration code, а не просить Jev напрямую выбрать действие.

---

# 21. MVP implementation proposal

## Component A — JevVerifier

Responsibilities:

- принять normalized artifact state;
- выполнить набор Jev questions;
- вернуть normalized signals;
- не выполнять routing самостоятельно.

Interface concept:

```ts
type VerificationSignals = {
  specificity: number;
  ambiguity: number;
  internalConsistency: number;
  sourceAlignment: number;
  completeness: number;
  repositoryDependency: number;
  productDecisionRequired: number;
  architectureDecisionRequired: number;
};

verifyArtifact(input): Promise<VerificationSignals>
```

---

## Component B — RoutingPolicy

Детерминированный слой.

```ts
route(signals, policy): RoutingDecision
```

Пример:

```ts
type RoutingDecision =
  | { target: "continue"; blocking: false }
  | { target: "claude"; reason: string; blocking: boolean }
  | { target: "codex"; reason: string; blocking: boolean }
  | { target: "human"; reason: string; blocking: true };
```

---

## Component C — ClaudeReviewer

Targeted roles:

```text
specificity_revision
source_alignment_review
completeness_review
architecture_review
```

Claude получает только:

- artifact;
- необходимый source/context;
- routing reason;
- конкретную mission.

---

## Component D — CodexVerifier

Targeted roles:

```text
repository_assumption_check
implementation_feasibility
api_contract_check
migration_impact_check
```

Codex должен возвращать evidence.

Концептуальный output:

```json
{
  "claims": [
    {
      "claim": "PaymentService.refund exists",
      "status": "verified | contradicted | unknown",
      "evidence": ["path:line", "symbol"]
    }
  ]
}
```

---

## Component E — Audit log

Для каждого gate сохранять:

```text
artifact_version
input_hash
Jev signals
threshold policy version
routing decision
reviewer invoked
review result
final outcome
human override
```

Это потребуется для calibration и eval.

---

# 22. Evaluation plan

Нужно собрать небольшой dataset реальных / синтетических примеров.

Минимум категории:

1. Конкретное и корректное требование.
2. Неконкретное требование.
3. Конкретное, но semantic drift.
4. Внутренне противоречивые требования.
5. Неполное требование.
6. Хороший implementation plan.
7. Plan с выдуманным API.
8. Plan с незамеченной migration.
9. Plan, содержащий product decision.
10. Plan, содержащий architecture decision.
11. Случай, где второй opinion не нужен.
12. Случай, где нужен Claude.
13. Случай, где нужен Codex.
14. Случай, где нужен Human.

Для каждого примера вручную определить expected routing.

Метрики:

- routing accuracy;
- false pass rate;
- unnecessary escalation rate;
- Claude calls avoided;
- Codex calls avoided;
- average latency;
- average cost;
- number of defects caught before implementation.

Особенно важная метрика:

```text
false negative pass
```

то есть случай, когда verifier разрешил дальнейшую работу, хотя артефакт содержал существенную проблему.

---

# 23. Что нужно доказать исследованием

MVP считается перспективным, если удаётся показать:

1. Jev дешёво обнаруживает достаточную долю проблемных артефактов.
2. Routing по узким signals работает лучше, чем один общий quality score.
3. Claude review действительно лучше используется для semantic/system problems.
4. Codex review лучше используется для repository/reality problems.
5. Human escalation срабатывает на genuine decision points.
6. Значительная часть простых кейсов проходит без второго дорогого reasoning call.
7. Targeted escalation дешевле и стабильнее, чем полный повторный review второй моделью.
8. Логи позволяют объяснить, почему был выбран конкретный route.

---

# 24. Что НЕ нужно делать в первой версии

Не строить сразу:

- автономного multi-agent architect;
- универсальную систему оценки любых документов;
- сложный graph orchestration framework;
- автоматическое изменение требований без traceability;
- автоматическое принятие продуктовых решений;
- один огромный Jev prompt на все возможные проверки.

Сначала нужен маленький эксперимент:

```text
Requirement / Plan
       ↓
      Jev
       ↓
  6–10 signals
       ↓
RoutingPolicy
   /    |    \
Claude Codex Human
```

---

# 25. Desired research output from Claude

В результате research phase нужен документ со следующими секциями:

## A. Jev capability validation

- актуальный API;
- primitives;
- examples;
- ограничения;
- pricing / latency, если доступны;
- вероятность / confidence semantics;
- suitability for proposed verifier.

## B. Architecture proposal

- components;
- data flow;
- contracts;
- state schema;
- routing policy;
- audit model.

## C. Concrete Jev schema

Дать конкретный рабочий пример кода с актуальным Jev SDK для:

- requirements verifier;
- plan verifier.

## D. Claude integration design

Дать 3–4 targeted review prompts / contracts.

## E. Codex integration design

Дать repository verification contract.

## F. Threshold / calibration approach

Не придумывать production thresholds без eval.

Предложить метод калибровки на dataset.

## G. MVP implementation plan

Пошаговый implementation plan:

```text
Step
Files/components
Input/output
Tests
Exit criteria
```

## H. Risks

Особенно проверить:

- overconfidence;
- poor calibration;
- context loss;
- semantic drift;
- duplicated reasoning;
- routing loops;
- excessive escalation;
- stale repository context;
- false sense of correctness.

---

# 26. Research instruction for Claude

Используй этот документ как архитектурную гипотезу, а не как доказанный дизайн.

Требуется:

1. Проверить актуальные возможности Jev / TypeSafe по официальной документации и примерам.
2. Отделить подтверждённые возможности от наших предположений.
3. Найти места, где дизайн не соответствует реальному API Jev.
4. Предложить минимально сложную реализацию.
5. Не строить framework раньше времени.
6. Сначала реализовать один end-to-end vertical slice:
   - requirement;
   - Jev verification;
   - deterministic routing;
   - Claude/Codex targeted review;
   - audit output.
7. Обязательно сохранить separation:
   - Jev detects / scores;
   - orchestration code routes;
   - Claude reasons semantically;
   - Codex verifies repository reality;
   - Human owns actual decisions.

---

# 27. Target end state

Желаемая архитектура:

```text
                   AI DEVELOPMENT CONTROL PLANE

                            JEV
                 cheap probabilistic gates
                             │
       ┌─────────────────────┼─────────────────────┐
       │                     │                     │
       ▼                     ▼                     ▼
    Claude                 Codex                 Human
   semantics               reality              authority
   architecture            code                 choice
   requirements            APIs                 policy
   completeness            schemas              risk
                             │
                             ▼
                    deterministic workflow
                             │
                             ▼
                     safer implementation
```

Главная идея:

> Claude и Codex выполняют дорогую интеллектуальную работу только тогда, когда дешёвый verifier обнаружил конкретную причину её выполнять.

Jev в этой архитектуре — не «ещё один агент».

Jev — **scheduler / control plane интеллектуальной работы**.
