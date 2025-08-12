import type { Route } from "./+types/chat.$chatId";
import { useState, useEffect, useRef } from "react";
import { Send } from "lucide-react";
import { useNavigate, useLocation } from "react-router";
import { supabase, type Chat, type Message } from "~/lib/supabase-simple";
import { useAuth } from "~/lib/supabase-auth";
import { AppLayout } from "~/components/AppLayout";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "Chat - Tinygen" },
    { name: "description", content: "Chat with your AI assistant" },
  ];
}

export default function ChatPage({ params }: Route.ComponentProps) {
  const chatId = params.chatId;
  const [message, setMessage] = useState("");
  const [currentChat, setCurrentChat] = useState<Chat | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingMessages, setIsLoadingMessages] = useState(true);
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const channelRef = useRef<any>(null);
  const hasCalledEndpoint = useRef(false);

  // Handle initial navigation from home page
  useEffect(() => {
    if (location.state?.initialChat && location.state?.initialMessage && !hasCalledEndpoint.current) {
      console.log('Received initial chat data from navigation');
      setCurrentChat(location.state.initialChat);
      
      // Add the initial message to the display
      const initialUserMessage = {
        id: `temp-${Date.now()}`,
        chat_id: chatId,
        content: location.state.initialMessage,
        role: 'user' as const,
        is_tool_use: false,
        created_at: new Date().toISOString(),
        metadata: {}
      };
      setMessages([initialUserMessage]);
      
      // Call the endpoint immediately
      if (location.state.initialChat.github_repo_url) {
        callClaudeAgent(location.state.initialChat, location.state.initialMessage);
        hasCalledEndpoint.current = true;
      }
    }
  }, [location.state]);

  // Load chat and messages
  useEffect(() => {
    if (!user || !chatId) return;
    
    // Don't load if we already have the data from navigation
    if (location.state?.initialChat) {
      setIsLoadingMessages(false);
      return;
    }
    
    loadChatAndMessages();
  }, [chatId, user]);

  // Subscribe to realtime messages
  useEffect(() => {
    if (!chatId || !user) return;

    // Don't create a new subscription if we already have one for this chat
    if (channelRef.current) {
      const currentChannelName = channelRef.current.topic;
      if (currentChannelName === `messages_${chatId}`) {
        console.log('Already subscribed to this chat, skipping');
        return;
      }
      // Different chat, cleanup old subscription
      console.log('Cleaning up previous subscription');
      supabase.removeChannel(channelRef.current);
      channelRef.current = null;
    }

    console.log(`Creating realtime subscription for chat ${chatId}`);
    
    // Create new subscription
    const channel = supabase
      .channel(`messages_${chatId}`)
      .on(
        'postgres_changes',
        { 
          event: 'INSERT', 
          schema: 'public', 
          table: 'messages',
          filter: `chat_id=eq.${chatId}`
        },
        (payload) => {
          console.log('Realtime message received:', payload);
          const newMessage = payload.new as Message;
          // Only add if it's not from the current user (to avoid duplicates)
          if (newMessage.role === 'assistant') {
            setMessages(prev => {
              // Check if message already exists to avoid duplicates
              const exists = prev.some(msg => msg.id === newMessage.id);
              if (exists) {
                console.log('Message already exists, skipping:', newMessage.id);
                return prev;
              }
              console.log('Adding new message:', newMessage);
              return [...prev, newMessage];
            });
          }
        }
      )
      .subscribe((status, error) => {
        console.log('Realtime subscription status:', status);
        if (error) {
          console.error('Realtime subscription error:', error);
        }
      });

    channelRef.current = channel;

    // Cleanup only on unmount or when chatId changes
    return () => {
      if (channelRef.current) {
        console.log('Cleaning up subscription');
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
    };
  }, [chatId]); // Remove user from dependencies to prevent reconnections

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    setTimeout(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, 100);
  }, [messages, isLoading]);

  const loadChatAndMessages = async () => {
    setIsLoadingMessages(true);
    try {
      const [chatResult, messagesResult] = await Promise.all([
        supabase.from('chats').select('*').eq('id', chatId).eq('user_id', user?.id).single(),
        supabase.from('messages').select('*').eq('chat_id', chatId).order('created_at', { ascending: true })
      ]);
      
      if (chatResult.error) {
        console.error('Chat not found:', chatResult.error);
        navigate('/');
        return;
      }
      
      if (messagesResult.error) throw messagesResult.error;
      
      setCurrentChat(chatResult.data);
      setMessages(messagesResult.data || []);
    } catch (error) {
      console.error('Error loading chat:', error);
      navigate('/');
    } finally {
      setIsLoadingMessages(false);
    }
  };

  const callClaudeAgent = async (chat: Chat, prompt: string) => {
    if (!chat.github_repo_url) return;

    try {
      const backendUrl = import.meta.env.VITE_BACKEND_URL || 'http://localhost:8000';
      
      console.log('Calling Claude agent with:', {
        chat_id: chat.id,
        repo_url: chat.github_repo_url,
        prompt: prompt,
      });
      
      const response = await fetch(`${backendUrl}/run-claude-agent`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          chat_id: chat.id,
          repo_url: chat.github_repo_url,
          user_github_username: user?.user_metadata?.user_name || user?.email?.split('@')[0] || 'unknown',
          prompt: prompt,
        }),
      });

      const result = await response.json();
      console.log('Claude agent response:', result);
      
      if (result.status === 'started') {
        console.log('Claude agent started successfully');
        // The messages will come through realtime subscription
      } else {
        console.error('Failed to start Claude agent:', result.error);
        // Add error message
        const { data: errorMessage } = await supabase
          .from('messages')
          .insert({
            chat_id: chat.id,
            content: `Error: ${result.error || 'Failed to start AI agent'}`,
            role: 'assistant',
            metadata: {},
          })
          .select()
          .single();
        
        if (errorMessage) {
          setMessages(prev => [...prev, errorMessage]);
        }
      }
    } catch (error) {
      console.error('Error calling Claude agent:', error);
      // Add error message
      const { data: errorMessage } = await supabase
        .from('messages')
        .insert({
          chat_id: chat.id,
          content: `Error: Failed to connect to AI backend. Please check if the backend is running.`,
          role: 'assistant',
          metadata: {},
        })
        .select()
        .single();
      
      if (errorMessage) {
        setMessages(prev => [...prev, errorMessage]);
      }
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    console.log('handleSubmit called');
    console.log('message:', message);
    console.log('user:', user);
    console.log('currentChat:', currentChat);
    
    if (!message.trim() || !user) {
      console.log('Validation failed - missing message or user');
      return;
    }
    
    // Wait for chat to load if it hasn't yet
    if (!currentChat && isLoadingMessages) {
      console.log('Chat still loading, waiting...');
      return;
    }
    
    if (!currentChat) {
      console.error('No current chat found!');
      return;
    }

    setIsLoading(true);
    try {
      // Add user message
      const { data: userMessage, error: userError } = await supabase
        .from('messages')
        .insert({
          chat_id: chatId,
          content: message,
          role: 'user',
          is_tool_use: false,
          metadata: {},
        })
        .select()
        .single();
      
      if (userError) throw userError;
      
      setMessages(prev => [...prev, userMessage]);
      setMessage('');
      
      // Scroll to bottom after adding message
      setTimeout(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
      }, 50);

      // Update chat's updated_at
      await supabase
        .from('chats')
        .update({ updated_at: new Date().toISOString() })
        .eq('id', chatId);

      // Call Claude agent
      await callClaudeAgent(currentChat, message);
    } catch (error) {
      console.error('Error sending message:', error);
    } finally {
      setIsLoading(false);
    }
  };

  if (!user) {
    navigate('/');
    return null;
  }

  return (
    <AppLayout>
      <div className="fixed inset-0 flex">
        <div className="flex-1 flex items-center justify-center">
          <div className="w-full max-w-3xl h-full flex flex-col p-4">
            {/* Messages Area - takes up available space */}
            <div className="flex-1 overflow-y-auto">
              {isLoadingMessages ? (
                <div className="flex flex-col items-center justify-center h-full">
                  <div className="relative">
                    <div className="w-12 h-12 border-4 border-blue-500/20 rounded-full"></div>
                    <div className="absolute top-0 left-0 w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
                  </div>
                  <p className="text-white/40 mt-4">Loading messages...</p>
                </div>
              ) : (
                <div className="space-y-4 p-4">
                  {messages.map((msg) => {
                    // Check if this is a tool use message
                    const isToolUse = msg.is_tool_use === true;
                    const toolData = isToolUse ? msg.metadata?.tool_data : null;
                    
                    return (
                      <div
                        key={msg.id}
                        className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                      >
                        {isToolUse && toolData ? (
                          // Tool use rendering
                          <div className="max-w-[80%] px-4 py-3 rounded-2xl bg-blue-500/10 border border-blue-500/20">
                            <div className="flex items-center gap-2 mb-1">
                              <span className="text-lg">{toolData.icon || '🔧'}</span>
                              <span className="text-blue-300 font-medium">{toolData.description || msg.content}</span>
                            </div>
                            {toolData.summary && (
                              <p className="text-white/70 text-sm">{toolData.summary}</p>
                            )}
                            {toolData.input && Object.keys(toolData.input).length > 0 && (
                              <div className="mt-2 text-xs text-white/50">
                                {Object.entries(toolData.input).map(([key, value]) => (
                                  <div key={key}>
                                    <span className="text-white/70">{key}:</span> {String(value)}
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        ) : (
                          // Regular message rendering
                          <div
                            className={`max-w-[80%] px-4 py-3 rounded-2xl ${
                              msg.role === 'user'
                                ? 'bg-white/10 text-white'
                                : 'bg-white/5 text-white/90 border border-white/10'
                            }`}
                          >
                            <p className="whitespace-pre-wrap">{msg.content}</p>
                          </div>
                        )}
                      </div>
                    );
                  })}
                  
                  {isLoading && (
                    <div className="flex justify-start">
                      <div className="bg-white/5 text-white/60 px-4 py-3 rounded-2xl border border-white/10">
                        <div className="flex items-center gap-2">
                          <div className="w-2 h-2 bg-white/60 rounded-full animate-pulse" />
                          <div className="w-2 h-2 bg-white/60 rounded-full animate-pulse delay-75" />
                          <div className="w-2 h-2 bg-white/60 rounded-full animate-pulse delay-150" />
                        </div>
                      </div>
                    </div>
                  )}
                  
                  <div ref={messagesEndRef} />
                </div>
              )}
            </div>

            {/* Chat input - fixed at bottom */}
            <div className="mt-4 pb-2">
              <form 
                onSubmit={(e) => {
                  console.log('Form onSubmit triggered!');
                  handleSubmit(e);
                }} 
                className="w-full"
              >
                <div className="relative group">
                  <input
                    type="text"
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    placeholder="Ask me anything..."
                    disabled={isLoading}
                    className="w-full px-4 py-3 pr-12 bg-white/5 backdrop-blur-md rounded-xl border border-white/10 text-white placeholder-white/40 focus:outline-none focus:border-white/20 focus:bg-white/10 transition-all duration-300 disabled:opacity-50"
                  />
                  <button
                    type="submit"
                    disabled={isLoading || !message.trim() || !currentChat || isLoadingMessages}
                    onClick={() => console.log('Button clicked!')}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-2 bg-white/5 hover:bg-white/10 rounded-lg transition-all duration-200 group-focus-within:bg-white/10 disabled:opacity-50 cursor-pointer"
                  >
                    <Send className="w-5 h-5 text-white/80 group-focus-within:text-white" />
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      </div>
    </AppLayout>
  );
}