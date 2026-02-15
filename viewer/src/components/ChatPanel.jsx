import { useEffect, useMemo, useState } from 'react'

const MAX_VISIBLE_PARTS = 8
const MAX_VISIBLE_TOOLS = 8
const MAX_VISIBLE_TORQUE = 10
const MAX_VISIBLE_CITATIONS = 12
const CHAT_SETTINGS_STORAGE_KEY = 'tis.chat.settings.v1'
const CHAT_HISTORY_STORAGE_KEY = 'tis.chat.history.v1'
const CONVERSATION_TITLE_MAX_LEN = 60
const DEFAULT_CHAT_SETTINGS = {
  provider: '',
  apiKey: '',
  model: '',
}

function loadConversations() {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(CHAT_HISTORY_STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter(c => c && typeof c.id === 'string' && Array.isArray(c.messages))
      .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
  } catch (_) {
    return []
  }
}

function saveConversation(conv) {
  if (typeof window === 'undefined' || !conv?.id) return
  const list = loadConversations().filter(c => c.id !== conv.id)
  list.unshift(conv)
  try {
    window.localStorage.setItem(CHAT_HISTORY_STORAGE_KEY, JSON.stringify(list))
  } catch (_) {}
}

function deleteConversation(id) {
  if (typeof window === 'undefined' || !id) return
  const list = loadConversations().filter(c => c.id !== id)
  try {
    window.localStorage.setItem(CHAT_HISTORY_STORAGE_KEY, JSON.stringify(list))
  } catch (_) {}
}

function conversationTitle(messages) {
  const first = messages?.find(m => m.role === 'user')
  const text = first?.text?.trim() || 'New conversation'
  if (text.length <= CONVERSATION_TITLE_MAX_LEN) return text
  return text.slice(0, CONVERSATION_TITLE_MAX_LEN) + '…'
}

function formatRelativeTime(ts) {
  if (!ts || typeof ts !== 'number') return ''
  const d = new Date(ts)
  const now = Date.now()
  const diff = now - ts
  if (diff < 60 * 1000) return 'Just now'
  if (diff < 60 * 60 * 1000) return `${Math.floor(diff / 60000)}m ago`
  if (diff < 24 * 60 * 60 * 1000) return `${Math.floor(diff / 3600000)}h ago`
  if (diff < 7 * 24 * 60 * 60 * 1000) return `${Math.floor(diff / 86400000)}d ago`
  return d.toLocaleDateString()
}

function getInitialChatSettings() {
  if (typeof window === 'undefined') return DEFAULT_CHAT_SETTINGS
  try {
    const raw = window.localStorage.getItem(CHAT_SETTINGS_STORAGE_KEY)
    if (!raw) return DEFAULT_CHAT_SETTINGS
    const parsed = JSON.parse(raw)
    const provider = parsed && typeof parsed.provider === 'string' ? parsed.provider.toLowerCase() : ''
    return {
      provider: provider === 'claude' ? 'anthropic' : provider,
      apiKey: parsed && typeof parsed.apiKey === 'string' ? parsed.apiKey : '',
      model: parsed && typeof parsed.model === 'string' ? parsed.model : '',
    }
  } catch (_) {
    return DEFAULT_CHAT_SETTINGS
  }
}

function providerLabel(provider) {
  if (provider === 'openai') return 'OpenAI'
  if (provider === 'anthropic') return 'Anthropic'
  return 'Retrieval only'
}

function ChatPanel({ selectedEngine }) {
  const [isOpen, setIsOpen] = useState(false)
  const [activeConversationId, setActiveConversationId] = useState(null)
  const [conversations, setConversations] = useState(loadConversations)
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [chatSettings, setChatSettings] = useState(getInitialChatSettings)

  const engineLabel = useMemo(() => {
    if (selectedEngine === 'Z20LET') return 'Z20LET (Turbo)'
    if (selectedEngine === 'Z22SE') return 'Z22SE (NA)'
    return 'All engines'
  }, [selectedEngine])

  useEffect(() => {
    if (typeof window === 'undefined') return
    window.localStorage.setItem(CHAT_SETTINGS_STORAGE_KEY, JSON.stringify(chatSettings))
  }, [chatSettings])

  const refreshConversations = () => setConversations(loadConversations())

  const startNewConversation = () => {
    setActiveConversationId(typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `conv-${Date.now()}`)
    setMessages([])
    setInput('')
    setError(null)
  }

  const goToConversationList = () => {
    if (messages.length > 0) {
      const existing = conversations.find(c => c.id === activeConversationId)
      saveConversation({
        id: activeConversationId,
        title: conversationTitle(messages),
        createdAt: existing?.createdAt ?? Date.now(),
        updatedAt: Date.now(),
        engine: selectedEngine ?? '',
        messages,
      })
    }
    refreshConversations()
    setActiveConversationId(null)
    setMessages([])
    setInput('')
    setError(null)
  }

  const openConversation = (conv) => {
    setMessages(conv.messages)
    setActiveConversationId(conv.id)
    setError(null)
  }

  const handleDeleteConversation = (id, event) => {
    event.stopPropagation()
    deleteConversation(id)
    refreshConversations()
    if (id === activeConversationId) {
      setActiveConversationId(null)
      setMessages([])
      setInput('')
      setError(null)
    }
  }

  const resetConversation = () => {
    setMessages([])
    setInput('')
    setError(null)
  }

  const submit = async (event) => {
    event.preventDefault()
    const query = input.trim()
    if (!query || loading) return

    setError(null)
    setInput('')

    const userMessage = {
      id: `${Date.now()}-user`,
      role: 'user',
      text: query,
    }
    setMessages(prev => [...prev, userMessage])

    setLoading(true)
    const requestBody = {
      query,
      selectedEngine,
    }
    if (chatSettings.provider) {
      requestBody.provider = chatSettings.provider
      requestBody.llm = { provider: chatSettings.provider }
      const apiKey = chatSettings.apiKey.trim()
      const model = chatSettings.model.trim()
      if (apiKey) requestBody.llm.apiKey = apiKey
      if (model) requestBody.llm.model = model
    }

    const doRequest = (retryCount = 0) =>
      fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      }).then(async response => {
        const payload = await response.json().catch(() => null)
        if (response.status === 503 && payload?.retryAfter != null && retryCount < 2) {
          const sec = Math.min(Number(payload.retryAfter) || 15, 30)
          await new Promise(r => setTimeout(r, sec * 1000))
          return doRequest(retryCount + 1)
        }
        return { response, payload }
      })

    try {
      const { response, payload } = await doRequest()

      if (!response.ok) {
        const backendError =
          payload && typeof payload.error === 'string'
            ? payload.error
            : `Chat request failed: ${response.status}`
        const message =
          response.status >= 500
            ? `${backendError} (ensure \`npm run rag-server\` is running and indexes are built with \`npm run build-rag-index\`)`
            : backendError
        throw new Error(message)
      }

      const assistantPayload = payload?.response || {}

      const assistantMessage = {
        id: `${Date.now()}-assistant`,
        role: 'assistant',
        text: assistantPayload.answer || 'No answer generated.',
        data: assistantPayload,
      }
      setMessages(prev => {
        const next = [...prev, assistantMessage]
        if (activeConversationId) {
          const existing = conversations.find(c => c.id === activeConversationId)
          saveConversation({
            id: activeConversationId,
            title: conversationTitle(next),
            createdAt: existing?.createdAt ?? Date.now(),
            updatedAt: Date.now(),
            engine: selectedEngine ?? '',
            messages: next,
          })
          refreshConversations()
        }
        return next
      })
    } catch (err) {
      const message = err?.message || 'Failed to query chat API'
      if (/failed to fetch/i.test(message)) {
        setError('Chat API is unreachable. Start `npm run rag-server` and try again.')
      } else {
        setError(message)
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="chat-widget">
      {!isOpen && (
        <button
          type="button"
          className="chat-fab"
          onClick={() => setIsOpen(true)}
          aria-label="Open workshop assistant"
        >
          AI
        </button>
      )}

      {isOpen && (
        <div className="chat-panel" role="dialog" aria-label="Workshop assistant">
          <div className="chat-panel-header">
            <div>
              {activeConversationId ? (
                <button type="button" onClick={goToConversationList} className="chat-panel-back" aria-label="Back to conversations">
                  ← Conversations
                </button>
              ) : (
                <>
                  <div className="chat-panel-title">Workshop assistant</div>
                  <div className="chat-panel-subtitle">
                    {engineLabel} · {providerLabel(chatSettings.provider)}
                  </div>
                </>
              )}
            </div>
            <div className="chat-panel-actions">
              <button type="button" onClick={() => setSettingsOpen(prev => !prev)} className="chat-panel-action">
                {settingsOpen ? 'Hide settings' : 'Settings'}
              </button>
              {activeConversationId && (
                <button type="button" onClick={resetConversation} className="chat-panel-action">
                  Clear
                </button>
              )}
              <button type="button" onClick={() => setIsOpen(false)} className="chat-panel-action">
                Close
              </button>
            </div>
          </div>

          {settingsOpen && (
            <div className="chat-settings">
              <div className="chat-settings-row">
                <label htmlFor="chat-provider">Provider</label>
                <select
                  id="chat-provider"
                  value={chatSettings.provider}
                  onChange={event =>
                    setChatSettings(prev => ({
                      ...prev,
                      provider: event.target.value,
                    }))
                  }
                  disabled={loading}
                >
                  <option value="">Retrieval only (no LLM API)</option>
                  <option value="openai">OpenAI</option>
                  <option value="anthropic">Anthropic (Claude)</option>
                </select>
              </div>

              {chatSettings.provider && (
                <>
                  <div className="chat-settings-row">
                    <label htmlFor="chat-api-key">API key</label>
                    <input
                      id="chat-api-key"
                      type="password"
                      value={chatSettings.apiKey}
                      onChange={event =>
                        setChatSettings(prev => ({
                          ...prev,
                          apiKey: event.target.value,
                        }))
                      }
                      placeholder={chatSettings.provider === 'openai' ? 'sk-...' : 'sk-ant-...'}
                      autoComplete="off"
                      spellCheck={false}
                      disabled={loading}
                    />
                  </div>

                  <div className="chat-settings-row">
                    <label htmlFor="chat-model">Model (optional)</label>
                    <input
                      id="chat-model"
                      type="text"
                      value={chatSettings.model}
                      onChange={event =>
                        setChatSettings(prev => ({
                          ...prev,
                          model: event.target.value,
                        }))
                      }
                      placeholder={chatSettings.provider === 'openai' ? 'gpt-4o-mini' : 'claude-3-5-sonnet-latest'}
                      autoComplete="off"
                      spellCheck={false}
                      disabled={loading}
                    />
                  </div>
                </>
              )}

              <div className="chat-settings-footer">
                <div className="chat-settings-note">Saved locally in this browser only.</div>
                {chatSettings.provider && chatSettings.apiKey && (
                  <button
                    type="button"
                    className="chat-panel-action"
                    onClick={() =>
                      setChatSettings(prev => ({
                        ...prev,
                        apiKey: '',
                      }))
                    }
                    disabled={loading}
                  >
                    Clear key
                  </button>
                )}
              </div>
            </div>
          )}

          {activeConversationId === null ? (
            <div className="chat-conv-list">
              <button type="button" onClick={startNewConversation} className="chat-conv-new">
                New conversation
              </button>
              {conversations.length === 0 && (
                <div className="chat-empty">No conversations yet. Start one to get help with procedures, parts, and torque.</div>
              )}
              {conversations.map(conv => (
                <div
                  key={conv.id}
                  className="chat-conv-item"
                  onClick={() => openConversation(conv)}
                  onKeyDown={e => e.key === 'Enter' && openConversation(conv)}
                  role="button"
                  tabIndex={0}
                >
                  <div className="chat-conv-item-main">
                    <span className="chat-conv-item-title">{conv.title || 'Untitled'}</span>
                    <span className="chat-conv-item-meta">
                      {formatRelativeTime(conv.updatedAt)} · {conv.messages?.length ?? 0} messages
                      {conv.engine ? ` · ${conv.engine}` : ''}
                    </span>
                  </div>
                  <button
                    type="button"
                    className="chat-conv-item-delete"
                    onClick={e => handleDeleteConversation(conv.id, e)}
                    aria-label="Delete conversation"
                  >
                    Delete
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <>
              <div className="chat-messages">
                {messages.length === 0 && (
                  <div className="chat-empty">
                    Ask a workshop question, for example:
                    <br />
                    <span>"I need to replace my turbo on a Z20LET"</span>
                  </div>
                )}

                {messages.map(message => (
                  <div key={message.id} className={`chat-message chat-message-${message.role}`}>
                    <div className="chat-message-text">{message.text}</div>

                    {message.role === 'assistant' && message.data && (
                      <div className="chat-message-sections">
                    {message.data.procedureSummary && (
                      <div className="chat-section">
                        <div className="chat-section-title">Procedure summary</div>
                        <div className="chat-section-body">{message.data.procedureSummary}</div>
                      </div>
                    )}

                    {Array.isArray(message.data.requiredParts) && message.data.requiredParts.length > 0 && (
                      <div className="chat-section">
                        <div className="chat-section-title">Required parts</div>
                        <ul className="chat-list">
                          {message.data.requiredParts.slice(0, MAX_VISIBLE_PARTS).map((part, index) => (
                            <li key={`${part.partNo}-${index}`}>
                              <span className="chat-list-label">{part.partNo || 'N/A'}</span>
                              {' - '}
                              {part.description || 'Unknown part'}
                              {part.diagramUrl && (
                                <>
                                  {' '}
                                  <a href={part.diagramUrl} className="chat-link">
                                    Locate ({part.ref || '?'})
                                  </a>
                                </>
                              )}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {Array.isArray(message.data.requiredTools) && message.data.requiredTools.length > 0 && (
                      <div className="chat-section">
                        <div className="chat-section-title">Tools</div>
                        <ul className="chat-list">
                          {message.data.requiredTools.slice(0, MAX_VISIBLE_TOOLS).map((tool, index) => (
                            <li key={`${tool.code || tool.name || index}`}>
                              <span className="chat-list-label">{tool.code || 'Tool'}</span>
                              {tool.name ? ` - ${tool.name}` : ''}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {Array.isArray(message.data.torqueSpecs) && message.data.torqueSpecs.length > 0 && (
                      <div className="chat-section">
                        <div className="chat-section-title">Torque specs</div>
                        <ul className="chat-list">
                          {message.data.torqueSpecs.slice(0, MAX_VISIBLE_TORQUE).map((spec, index) => (
                            <li key={`${spec.component || 'torque'}-${index}`}>
                              {spec.component || 'Component'}: {spec.value || '?'} {spec.unit || ''}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {Array.isArray(message.data.warnings) && message.data.warnings.length > 0 && (
                      <div className="chat-section">
                        <div className="chat-section-title">Warnings</div>
                        <ul className="chat-list">
                          {message.data.warnings.map((warning, index) => (
                            <li key={`warning-${index}`}>{warning}</li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {Array.isArray(message.data.citations) && message.data.citations.length > 0 && (
                      <div className="chat-section">
                        <div className="chat-section-title">Sources</div>
                        <ul className="chat-list">
                          {message.data.citations.slice(0, MAX_VISIBLE_CITATIONS).map((citation, index) => (
                            <li key={`${citation.chunkId || citation.url || index}`}>
                              <a href={citation.url || '#'} className="chat-link">
                                {citation.title || citation.docId || `Source ${index + 1}`}
                              </a>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                      </div>
                    )}
                  </div>
                ))}
                {loading && <div className="chat-loading">Thinking...</div>}
                {error && <div className="chat-error">{error}</div>}
              </div>

              <form className="chat-input-row" onSubmit={submit}>
                <input
                  type="text"
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  placeholder="Ask about procedures, parts, torque..."
                  disabled={loading}
                />
                <button type="submit" disabled={loading || !input.trim()}>
                  Send
                </button>
              </form>
            </>
          )}
        </div>
      )}
    </div>
  )
}

export default ChatPanel

