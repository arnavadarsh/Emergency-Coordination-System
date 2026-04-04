import { useState, useEffect, useRef, useCallback } from 'react';
import '../styles/TriageChat.css';
import {
  getFirstQuestionId,
  getQuestion,
  getNextQuestionId,
  buildState,
  generateTriageResult,
  getSeverityEmoji,
  getAmbulanceTypeLabel,
  type TriageResult,
  type TriageState,
  type SeverityLevel,
} from '../services/triageEngine';

// ── Types ─────────────────────────────────────────────────────────────────────

interface ChatMessage {
  id: string;
  type: 'system' | 'user';
  text: string;
  subtext?: string;
}

interface TriageChatProps {
  onComplete: (result: TriageResult) => void;
}

// Palette matching Dashboard.css
const SEV_COLORS: Record<SeverityLevel, string> = {
  CRITICAL: '#de350b',
  HIGH: '#ff8b00',
  MODERATE: '#ffab00',
  LOW: '#00875a',
};

// ── Component ─────────────────────────────────────────────────────────────────

export default function TriageChat({ onComplete }: TriageChatProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [currentQuestionId, setCurrentQuestionId] = useState<string | null>(null);
  const [isTyping, setIsTyping] = useState(false);
  const [triageResult, setTriageResult] = useState<TriageResult | null>(null);
  const [painValue, setPainValue] = useState(5);
  const [textValue, setTextValue] = useState('');

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const chatContainerRef = useRef<HTMLDivElement>(null);

  // ── State derivation ──
  const currentState: TriageState = buildState(answers);
  const currentQuestion = currentQuestionId ? getQuestion(currentQuestionId) : null;

  // ── Auto-scroll ──
  const scrollToBottom = useCallback(() => {
    setTimeout(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, 100);
  }, []);

  // ── Initialize ──
  useEffect(() => {
    const firstId = getFirstQuestionId();
    const firstQuestion = getQuestion(firstId);
    if (firstQuestion) {
      setMessages([
        {
          id: 'welcome',
          type: 'system',
          text: '🏥 AI Emergency Triage activated. I\'ll ask a few questions to assess the emergency and determine the right ambulance response.',
        },
      ]);
      setIsTyping(true);
      setTimeout(() => {
        setIsTyping(false);
        setMessages(prev => [
          ...prev,
          {
            id: firstId,
            type: 'system',
            text: firstQuestion.text,
            subtext: firstQuestion.subtext,
          },
        ]);
        setCurrentQuestionId(firstId);
        scrollToBottom();
      }, 600);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    scrollToBottom();
  }, [messages, isTyping, scrollToBottom]);

  // ── Handle answer submission ──
  const handleAnswer = useCallback((answer: string) => {
    if (!currentQuestionId) return;

    const newAnswers = { ...answers, [currentQuestionId]: answer };
    setAnswers(newAnswers);

    // Add user message
    setMessages(prev => [
      ...prev,
      { id: `ans-${currentQuestionId}`, type: 'user', text: answer },
    ]);

    // Get next question
    const nextId = getNextQuestionId(currentQuestionId, answer, buildState(newAnswers));

    if (nextId) {
      const nextQ = getQuestion(nextId);
      if (nextQ) {
        setIsTyping(true);
        setCurrentQuestionId(null);

        const delay = 500 + Math.random() * 400;
        setTimeout(() => {
          setIsTyping(false);
          setMessages(prev => [
            ...prev,
            {
              id: nextId,
              type: 'system',
              text: nextQ.text,
              subtext: nextQ.subtext,
            },
          ]);
          setCurrentQuestionId(nextId);
        }, delay);
      }
    } else {
      // Triage complete
      setCurrentQuestionId(null);
      setIsTyping(true);

      setTimeout(() => {
        setIsTyping(false);
        const result = generateTriageResult(newAnswers);
        setTriageResult(result);
        setMessages(prev => [
          ...prev,
          {
            id: 'complete',
            type: 'system',
            text: '✅ Assessment complete. Review the result, then click "Request Emergency Ambulance" below.',
          },
        ]);
        
        // Immediately notify parent so the external "Request Emergency Ambulance" button is enabled
        onComplete(result);
      }, 900);
    }

    setTextValue('');
    setPainValue(5);
  }, [currentQuestionId, answers]);

  // ── Restart ──
  const handleRestart = useCallback(() => {
    setMessages([]);
    setAnswers({});
    setTriageResult(null);
    setCurrentQuestionId(null);
    setPainValue(5);
    setTextValue('');

    const firstId = getFirstQuestionId();
    const firstQuestion = getQuestion(firstId);
    if (firstQuestion) {
      setMessages([
        {
          id: 'welcome',
          type: 'system',
          text: '🏥 Triage restarted. Let\'s begin the assessment again.',
        },
      ]);
      setIsTyping(true);
      setTimeout(() => {
        setIsTyping(false);
        setMessages(prev => [
          ...prev,
          {
            id: firstId,
            type: 'system',
            text: firstQuestion.text,
            subtext: firstQuestion.subtext,
          },
        ]);
        setCurrentQuestionId(firstId);
      }, 600);
    }
  }, []);

  // ── Render input ──
  const renderInput = () => {
    if (!currentQuestion || isTyping) return null;

    switch (currentQuestion.type) {
      case 'yes_no':
        return (
          <div className="triage-input-buttons">
            <button className="triage-btn triage-btn-yes" onClick={() => handleAnswer('Yes')}>
              ✓ Yes
            </button>
            <button className="triage-btn triage-btn-no" onClick={() => handleAnswer('No')}>
              ✗ No
            </button>
          </div>
        );

      case 'multiple_choice':
        return (
          <div className="triage-input-buttons">
            {currentQuestion.options?.map((option) => (
              <button
                key={option}
                className="triage-btn triage-btn-option"
                onClick={() => handleAnswer(option)}
              >
                {option}
              </button>
            ))}
          </div>
        );

      case 'pain_scale': {
        const painColor = painValue <= 3 ? '#00875a' : painValue <= 6 ? '#ffab00' : painValue <= 8 ? '#ff8b00' : '#de350b';
        return (
          <div className="triage-pain-scale">
            <div className="triage-pain-value" style={{ color: painColor }}>
              {painValue}
            </div>
            <div className="triage-pain-slider-track">
              <input
                type="range"
                min="0"
                max="10"
                value={painValue}
                onChange={(e) => setPainValue(parseInt(e.target.value))}
                className="triage-pain-slider"
              />
            </div>
            <div className="triage-pain-labels">
              <span>0 — No pain</span>
              <span>10 — Worst pain</span>
            </div>
            <button className="triage-pain-submit" onClick={() => handleAnswer(String(painValue))}>
              Confirm: {painValue}/10
            </button>
          </div>
        );
      }

      case 'text':
        return (
          <div className="triage-text-input-group">
            <input
              type="text"
              className="triage-text-input"
              placeholder="Describe the emergency..."
              value={textValue}
              onChange={(e) => setTextValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && textValue.trim()) {
                  handleAnswer(textValue.trim());
                }
              }}
            />
            <button
              className="triage-text-submit"
              onClick={() => {
                if (textValue.trim()) handleAnswer(textValue.trim());
              }}
            >
              Send →
            </button>
          </div>
        );

      default:
        return null;
    }
  };

  const severityClass = (s: SeverityLevel) => s.toLowerCase();

  return (
    <div className="triage-chat-wrapper">
      {/* ── Chat Panel ── */}
      <div className="triage-chat-panel">
        <div className="triage-chat-header">
          <div className="triage-chat-header-icon">🤖</div>
          <div>
            <h3>Emergency Triage AI</h3>
            <p>Step-by-step severity assessment</p>
          </div>
          {currentQuestion && (
            <div className="triage-step-indicator">
              Step {currentQuestion.step} of 4
            </div>
          )}
        </div>

        <div className="triage-chat-messages" ref={chatContainerRef}>
          {messages.map((msg) => (
            <div key={msg.id} className={`triage-message ${msg.type}`}>
              <div className="triage-message-avatar">
                {msg.type === 'system' ? '🤖' : '👤'}
              </div>
              <div className="triage-message-bubble">
                {msg.text}
                {msg.subtext && (
                  <span className="triage-message-subtext">{msg.subtext}</span>
                )}
              </div>
            </div>
          ))}

          {isTyping && (
            <div className="triage-typing-indicator">
              <div className="triage-typing-dots">
                <span></span><span></span><span></span>
              </div>
              <span className="triage-typing-text">Analyzing...</span>
            </div>
          )}

          {/* ── Final Assessment Card ── */}
          {triageResult && (
            <div className="triage-assessment-card">
              <div className={`triage-assessment-header ${severityClass(triageResult.severity)}`}>
                <span style={{ fontSize: '24px' }}>
                  {getSeverityEmoji(triageResult.severity)}
                </span>
                <h3>Emergency Assessment</h3>
                <span className="severity-label">{triageResult.severity}</span>
              </div>

              <div className="triage-assessment-body">
                {/* Summary Grid */}
                <div className="triage-assessment-section">
                  <h4>Assessment Summary</h4>
                  <div className="triage-assessment-grid">
                    <div className="triage-assessment-item">
                      <div className="label">Severity</div>
                      <div className="value" style={{ color: SEV_COLORS[triageResult.severity] }}>
                        {triageResult.severity}
                      </div>
                    </div>
                    <div className="triage-assessment-item">
                      <div className="label">Emergency Type</div>
                      <div className="value" style={{ textTransform: 'capitalize' }}>
                        {triageResult.emergencyType}
                      </div>
                    </div>
                    <div className="triage-assessment-item">
                      <div className="label">Ambulance Type</div>
                      <div className="value">{getAmbulanceTypeLabel(triageResult.ambulance.type)}</div>
                    </div>
                    <div className="triage-assessment-item">
                      <div className="label">Pain Level</div>
                      <div className="value">{triageResult.painLevel}/10</div>
                    </div>
                  </div>
                </div>

                {/* Hospital */}
                <div className="triage-assessment-section">
                  <h4>🏥 Recommended Hospital</h4>
                  <div className="triage-assessment-item" style={{ background: '#e3fcef', borderColor: '#00875a' }}>
                    <div className="value" style={{ color: '#00875a', fontSize: '13px' }}>
                      {triageResult.hospital.type}
                    </div>
                    <div className="label" style={{ marginTop: '3px', fontSize: '11px', color: '#6b778c' }}>
                      {triageResult.hospital.reason}
                    </div>
                  </div>
                </div>

                {/* Equipment */}
                <div className="triage-assessment-section">
                  <h4>🚑 Required Equipment</h4>
                  <div className="triage-equipment-tags">
                    {triageResult.ambulance.equipment.map((eq) => (
                      <span key={eq} className="triage-equip-tag">{eq}</span>
                    ))}
                  </div>
                </div>

                {/* Staff */}
                <div className="triage-assessment-section">
                  <h4>👨‍⚕️ Staff</h4>
                  <div className="triage-equipment-tags">
                    {triageResult.ambulance.staff.map((s) => (
                      <span key={s} className="triage-equip-tag" style={{ background: '#f5f7fa', color: '#172b4d', borderColor: '#e0e0e0' }}>
                        {s}
                      </span>
                    ))}
                  </div>
                </div>

                {/* Reasoning */}
                <div className="triage-assessment-section">
                  <h4>📋 Clinical Reasoning</h4>
                  <ul className="triage-reasoning-list">
                    {triageResult.reasoning.map((r, i) => (
                      <li key={i}>{r}</li>
                    ))}
                  </ul>
                </div>

                {/* Vitals */}
                <div className="triage-assessment-section">
                  <h4>Vital Signs</h4>
                  <div className="triage-assessment-grid">
                    <div className="triage-assessment-item">
                      <div className="label">Breathing</div>
                      <div className="value" style={{ color: triageResult.isBreathing ? '#00875a' : '#de350b' }}>
                        {triageResult.isBreathing ? '✓ Yes' : '✗ No'}
                      </div>
                    </div>
                    <div className="triage-assessment-item">
                      <div className="label">Conscious</div>
                      <div className="value" style={{ color: triageResult.isConscious ? '#00875a' : '#de350b' }}>
                        {triageResult.isConscious ? '✓ Yes' : '✗ No'}
                      </div>
                    </div>
                    <div className="triage-assessment-item">
                      <div className="label">Chest Pain</div>
                      <div className="value" style={{ color: triageResult.hasChestPain ? '#de350b' : '#00875a' }}>
                        {triageResult.hasChestPain ? '✗ Yes' : '✓ No'}
                      </div>
                    </div>
                    <div className="triage-assessment-item">
                      <div className="label">Severe Bleeding</div>
                      <div className="value" style={{ color: triageResult.hasSevereBleeding ? '#de350b' : '#00875a' }}>
                        {triageResult.hasSevereBleeding ? '✗ Yes' : '✓ No'}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Actions */}
                <div className="triage-assessment-actions">
                  <button className="triage-restart-btn" onClick={handleRestart}>
                    ↻ Redo Assessment
                  </button>
                </div>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* ── Input Area ── */}
        {!triageResult && (
          <div className="triage-chat-input-area">
            {renderInput()}
          </div>
        )}
      </div>

      {/* ── Status Panel (Right Sidebar) ── */}
      <div className="triage-status-panel">
        <div>
          <div className="triage-status-title">Current Severity</div>
          <div className={`triage-severity-badge ${severityClass(currentState.severity)}`}>
            {getSeverityEmoji(currentState.severity)} {currentState.severity}
          </div>
        </div>

        <div className="triage-status-card">
          <h4>Emergency Type</h4>
          <div className="triage-status-value" style={{ textTransform: 'capitalize' }}>
            {currentState.emergencyType === 'other' && Object.keys(answers).length < 4
              ? 'Assessing...'
              : currentState.emergencyType}
          </div>
        </div>

        {currentState.equipment.length > 0 && (
          <div className="triage-status-card">
            <h4>Equipment Needed</h4>
            <ul className="triage-equipment-list">
              {currentState.equipment.slice(0, 8).map((eq) => (
                <li key={eq}>{eq}</li>
              ))}
              {currentState.equipment.length > 8 && (
                <li style={{ opacity: 0.5 }}>+{currentState.equipment.length - 8} more</li>
              )}
            </ul>
          </div>
        )}

        {currentState.staff.length > 0 && (
          <div className="triage-status-card">
            <h4>Staff Required</h4>
            <div className="triage-staff-tags">
              {currentState.staff.map((s) => (
                <span key={s} className="triage-staff-tag">{s}</span>
              ))}
            </div>
          </div>
        )}

        {currentState.reasoning.length > 0 && (
          <div className="triage-status-card">
            <h4>Observations</h4>
            <ul className="triage-equipment-list">
              {currentState.reasoning.slice(0, 4).map((r, i) => (
                <li key={i} style={{ fontSize: '11px' }}>{r}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
