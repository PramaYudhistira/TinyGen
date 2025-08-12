import type { Route } from "./+types/home";
import { useState, useEffect } from "react";
import { Send } from "lucide-react";
import { Link, useSearchParams } from "react-router";
import { FaGithub } from "react-icons/fa";
import { supabase, type Chat, type Message } from "~/lib/supabase-simple";
import { useAuth } from "~/lib/supabase-auth";
import { AppLayout } from "~/components/AppLayout";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "Tinygen - AI Assistant" },
    { name: "description", content: "Your personal AI assistant" },
  ];
}

export default function Home() {
  const [message, setMessage] = useState("");
  const [githubUrl, setGithubUrl] = useState("");
  const [currentChatId, setCurrentChatId] = useState<string | null>(null);
  const [currentChat, setCurrentChat] = useState<Chat | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);
  const [showGithubWarning, setShowGithubWarning] = useState(false);
  const { user, signInWithGitHub, loading } = useAuth();
  const [searchParams] = useSearchParams();

  // Load chat from URL params if present, or clear if no params
  useEffect(() => {
    const chatId = searchParams.get('chat');
    if (chatId && user) {
      // Set the chat ID immediately to prevent showing new chat UI
      setCurrentChatId(chatId);
      loadChat(chatId);
    } else if (!chatId) {
      // Clear the chat when no chat param is present
      setCurrentChatId(null);
      setCurrentChat(null);
      setMessages([]);
      setGithubUrl('');
    }
  }, [searchParams, user]);

  // Load messages when chat changes
  useEffect(() => {
    if (currentChatId) {
      loadMessages(currentChatId);
    } else {
      setMessages([]);
    }
  }, [currentChatId]);

  const loadChat = async (chatId: string) => {
    try {
      const { data, error } = await supabase
        .from('chats')
        .select('*')
        .eq('id', chatId)
        .eq('user_id', user?.id)
        .single();
      
      if (error) throw error;
      if (data) {
        setCurrentChat(data);
        setGithubUrl(data.github_repo_url || '');
      }
    } catch (error) {
      console.error('Error loading chat:', error);
      // Clear chat ID if loading failed
      setCurrentChatId(null);
    }
  };

  const loadMessages = async (chatId: string) => {
    setIsLoadingMessages(true);
    try {
      const [chatResult, messagesResult] = await Promise.all([
        supabase.from('chats').select('*').eq('id', chatId).single(),
        supabase.from('messages').select('*').eq('chat_id', chatId).order('created_at', { ascending: true })
      ]);
      
      if (chatResult.error) throw chatResult.error;
      if (messagesResult.error) throw messagesResult.error;
      
      setCurrentChat(chatResult.data);
      setMessages(messagesResult.data || []);
    } catch (error) {
      console.error('Error loading messages:', error);
    } finally {
      setIsLoadingMessages(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!message.trim() || !user) return;

    setIsLoading(true);
    try {
      let chatId = currentChatId;
      
      // Create new chat if needed
      if (!chatId) {
        const { data: chat, error: chatError } = await supabase
          .from('chats')
          .insert({
            user_id: user.id,
            title: message.substring(0, 50) + (message.length > 50 ? '...' : ''),
            github_repo_url: githubUrl || null,
          })
          .select()
          .single();
        
        if (chatError) {
          console.error('Chat creation error:', chatError);
          throw chatError;
        }
        chatId = chat.id;
        setCurrentChatId(chatId);
        setCurrentChat(chat);
        setGithubUrl(''); // Clear GitHub URL after chat creation
      }

      // If there's a GitHub URL, call the backend to set up the sandbox
      if (githubUrl && chatId) {
        try {
          const backendUrl = import.meta.env.VITE_BACKEND_URL || 'http://localhost:8000';
          const response = await fetch(`${backendUrl}/create-sandbox`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              chat_id: chatId,
              repo_url: githubUrl,
              user_github_username: user.user_metadata?.user_name || user.email?.split('@')[0] || 'unknown',
            }),
          });

          const sandboxResult = await response.json();
          
          if (sandboxResult.status === 'success') {
            console.log('Sandbox created:', sandboxResult);
            // Update the local chat object with snapshot ID
            if (currentChat) {
              setCurrentChat({
                ...currentChat,
                snapshot_id: sandboxResult.snapshot_id,
              });
            }
          } else {
            console.error('Failed to create sandbox:', sandboxResult.error);
            // Show warning if GitHub App is not installed
            if (sandboxResult.error?.includes('installation') || sandboxResult.error?.includes('not installed')) {
              setShowGithubWarning(false); // Never show the warning since app is installed
            }
          }
        } catch (error) {
          console.error('Error calling backend:', error);
        }
      }

      // Add user message
      const { data: userMessage, error: userError } = await supabase
        .from('messages')
        .insert({
          chat_id: chatId,
          content: message,
          role: 'user',
          metadata: {},
        })
        .select()
        .single();
      
      if (userError) {
        console.error('Message creation error:', userError);
        throw userError;
      }
      setMessages(prev => [...prev, userMessage]);
      setMessage('');

      // Update chat's updated_at
      await supabase
        .from('chats')
        .update({ updated_at: new Date().toISOString() })
        .eq('id', chatId);

      // TODO: Send to backend for AI response
      // For now, just simulate a response
      setTimeout(async () => {
        const { data: assistantMessage, error: assistantError } = await supabase
          .from('messages')
          .insert({
            chat_id: chatId!,
            content: "I'm processing your request. This feature will be connected to the AI backend soon!",
            role: 'assistant',
            metadata: {},
          })
          .select()
          .single();
        
        if (!assistantError) {
          setMessages(prev => [...prev, assistantMessage]);
          await supabase
            .from('chats')
            .update({ updated_at: new Date().toISOString() })
            .eq('id', chatId!);
        }
      }, 1000);
    } catch (error) {
      console.error('Error sending message:', error);
    } finally {
      setIsLoading(false);
    }
  };




  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-black via-gray-950 to-black flex items-center justify-center">
        <div className="text-center">
          <div className="w-16 h-16 border-4 border-blue-500/30 border-t-blue-500 rounded-full animate-spin mx-auto mb-4"></div>
          <div className="text-white/70">Loading...</div>
        </div>
      </div>
    );
  }

  return (
    <AppLayout>
      <div className="relative z-10 min-h-screen flex items-center justify-center px-4">
        {/* Not signed in */}
        {!user ? (
          <>
            {/* Logo for sign-in page */}
            <div className="absolute top-8 left-8 z-50">
              <img 
                src="/Codegen_logo_white.svg" 
                alt="Tinygen Logo" 
                className="h-10 md:h-12 w-auto"
              />
            </div>
          <div className="text-center max-w-2xl mx-auto">
            <h1 className="text-4xl md:text-6xl font-bold text-white mb-4 bg-gradient-to-r from-blue-400 to-purple-400 bg-clip-text text-transparent">Welcome to Tinygen</h1>
            <p className="text-white/70 mb-8 text-lg md:text-xl">Your AI-powered coding assistant</p>
            <button
              onClick={signInWithGitHub}
              className="group relative bg-gradient-to-r from-blue-600/20 to-purple-600/20 hover:from-blue-600/30 hover:to-purple-600/30 text-white border border-white/20 backdrop-blur-sm px-8 py-4 rounded-xl transition-all duration-300 cursor-pointer hover:scale-105 hover:border-white/40 flex items-center gap-3 mx-auto font-medium"
            >
              <FaGithub className="w-6 h-6 group-hover:rotate-12 transition-transform duration-300" />
              Sign in with GitHub
            </button>
          </div>
          </>
        ) : (
            // Chat Interface
            <div className="w-full max-w-3xl flex flex-col" style={{ height: 'calc(100vh - 8rem)' }}>
              {/* GitHub App Warning Banner */}
              {showGithubWarning && githubUrl && (
                <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-4 mb-4 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span className="text-yellow-400 text-xl">⚠️</span>
                    <div>
                      <p className="text-yellow-200 font-medium">GitHub App Not Installed</p>
                      <p className="text-yellow-200/70 text-sm">Install the GitHub App to work with repositories</p>
                    </div>
                  </div>
                  <Link
                    to="/settings"
                    className="px-3 py-1 bg-yellow-500/20 hover:bg-yellow-500/30 text-yellow-200 rounded-lg text-sm transition-colors inline-block"
                  >
                    Go to Settings
                  </Link>
                </div>
              )}
              
              {/* Messages Area */}
              {currentChatId ? (
                <div className="flex-1 overflow-y-auto mb-6 space-y-4 pb-4">
                  {isLoadingMessages ? (
                    <div className="flex flex-col items-center justify-center py-12">
                      <div className="relative">
                        <div className="w-12 h-12 border-4 border-blue-500/20 rounded-full"></div>
                        <div className="absolute top-0 left-0 w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
                      </div>
                      <p className="text-white/40 mt-4">Loading messages...</p>
                    </div>
                  ) : (
                    <>
                  {messages.map((msg) => (
                    <div
                      key={msg.id}
                      className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                    >
                      <div
                        className={`max-w-[80%] px-4 py-3 rounded-2xl ${
                          msg.role === 'user'
                            ? 'bg-white/10 text-white'
                            : 'bg-white/5 text-white/90 border border-white/10'
                        }`}
                      >
                        <p className="whitespace-pre-wrap">{msg.content}</p>
                      </div>
                    </div>
                  ))}
                    </>
                  )}
                  {isLoading && !isLoadingMessages && (
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
                </div>
              ) : (
                <div className="flex-1 flex flex-col items-center justify-center">
                  {/* Welcome message */}
                  <div className="mb-8 text-center animate-fade-in">
                    <h2 className="text-3xl font-semibold text-white/90">
                      Hello, {user.user_metadata?.user_name || user.email?.split('@')[0] || "there"}! 👋
                    </h2>
                    <p className="text-white/60 mt-2">How can I help you today?</p>
                  </div>

                  {/* GitHub URL input */}
                  <div className="w-full mb-6 animate-fade-in">
                      <div className="relative group">
                        <FaGithub className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-white/40 z-10" />
                        <input
                          type="url"
                          value={githubUrl}
                          onChange={(e) => setGithubUrl(e.target.value)}
                          placeholder="Paste your GitHub repository URL (optional)"
                          className="w-full pl-12 pr-6 py-3 bg-white/5 backdrop-blur-md rounded-xl border border-white/10 text-white placeholder-white/40 focus:outline-none focus:border-white/20 focus:bg-white/10 transition-all duration-300"
                        />
                      </div>
                      <p className="text-xs text-white/40 mt-2 ml-1">
                        I'll work with your repository to make changes and create pull requests
                      </p>
                    </div>
                </div>
              )}

              {/* Chat input - Always at bottom */}
              <div className="mt-auto">
                <form 
                  onSubmit={handleSubmit}
                  className="w-full animate-slide-up"
                >
                  <div className="relative group">
                    <input
                      type="text"
                      value={message}
                      onChange={(e) => setMessage(e.target.value)}
                      placeholder="Ask me anything..."
                      disabled={isLoading}
                      className="w-full px-6 py-4 pr-14 bg-white/5 backdrop-blur-md rounded-2xl border border-white/10 text-white placeholder-white/40 focus:outline-none focus:border-white/20 focus:bg-white/10 transition-all duration-300 disabled:opacity-50"
                    />
                    <button
                      type="submit"
                      disabled={isLoading}
                      className="absolute right-2 top-1/2 -translate-y-1/2 p-3 bg-white/5 hover:bg-white/10 rounded-xl transition-all duration-200 group-focus-within:bg-white/10 disabled:opacity-50 cursor-pointer"
                    >
                      <Send className="w-5 h-5 text-white/80 group-focus-within:text-white" />
                    </button>
                  </div>
                </form>

                {/* Quick actions - Only show when no messages */}
                {messages.length === 0 && (
                  <div className="mt-6 flex flex-wrap gap-3 justify-center animate-fade-in-delayed">
                    {["Help me write code", "Explain a concept", "Generate ideas"].map((prompt) => (
                      <button
                        key={prompt}
                        onClick={() => setMessage(prompt)}
                        className="px-4 py-2 bg-white/5 backdrop-blur-sm rounded-xl border border-white/10 text-white/60 hover:bg-white/10 hover:text-white/80 hover:border-white/20 transition-all duration-200 text-sm cursor-pointer"
                      >
                        {prompt}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
        )}
      </div>
    </AppLayout>
  );
}