import type { Route } from "./+types/home";
import { useState, useEffect } from "react";
import { Send, Plus, Clock, LogOut } from "lucide-react";
import { FaGithub } from "react-icons/fa";
import { Button } from "~/components/ui/button";
import { Separator } from "~/components/ui/separator";
import { supabase, type Chat, type Message } from "~/lib/supabase-simple";
import { useAuth } from "~/lib/supabase-auth";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "TinyGen - AI Assistant" },
    { name: "description", content: "Your personal AI assistant" },
  ];
}

export default function Home() {
  const [message, setMessage] = useState("");
  const [githubUrl, setGithubUrl] = useState("");
  const [currentChatId, setCurrentChatId] = useState<string | null>(null);
  const [currentChat, setCurrentChat] = useState<Chat | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [recentChats, setRecentChats] = useState<Chat[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [activePage, setActivePage] = useState<'new' | 'recent'>('new');
  const [sidebarHovered, setSidebarHovered] = useState(false);
  const { user, signInWithGitHub, signOut, loading } = useAuth();

  // Load recent chats on mount
  useEffect(() => {
    if (user) {
      loadRecentChats();
    }
  }, [user]);

  // Load messages when chat changes
  useEffect(() => {
    if (currentChatId) {
      loadMessages(currentChatId);
    } else {
      setMessages([]);
    }
  }, [currentChatId]);

  const loadRecentChats = async () => {
    try {
      const { data, error } = await supabase
        .from('chats')
        .select('*')
        .eq('user_id', user?.id)
        .order('updated_at', { ascending: false });
      
      if (error) throw error;
      setRecentChats(data || []);
    } catch (error) {
      console.error('Error loading chats:', error);
    }
  };

  const loadMessages = async (chatId: string) => {
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
        loadRecentChats(); // Refresh recent chats
      }, 1000);
    } catch (error) {
      console.error('Error sending message:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const startNewChat = () => {
    setCurrentChatId(null);
    setCurrentChat(null);
    setMessages([]);
    setActivePage('new');
  };

  const selectChat = async (chat: Chat) => {
    setCurrentChatId(chat.id);
    setCurrentChat(chat);
    setGithubUrl(chat.github_repo_url || '');
    setActivePage('new');
  };

  const sidebarItems = [
    { icon: Plus, label: "New Task", active: activePage === 'new', onClick: startNewChat },
    { icon: Clock, label: "Recent Tasks", active: activePage === 'recent', onClick: () => setActivePage('recent') },
  ];

  if (loading) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <div className="text-white">Loading...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen relative overflow-hidden bg-black">
      {/* Much darker background with subtle gradient hints */}
      <div className="absolute inset-0">
        <div className="absolute top-0 left-1/4 w-96 h-96 bg-purple-900/10 rounded-full blur-3xl" />
        <div className="absolute bottom-0 right-1/4 w-96 h-96 bg-blue-900/10 rounded-full blur-3xl" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-indigo-900/5 rounded-full blur-3xl" />
      </div>

      {/* Sidebar - Only show when signed in */}
      {user && (
        <div 
          className={`absolute left-0 top-0 h-full bg-black/40 backdrop-blur-xl border-r border-white/10 z-50 transition-all duration-300 ${
            sidebarHovered ? 'w-64' : 'w-16'
          }`}
          onMouseEnter={() => setSidebarHovered(true)}
          onMouseLeave={() => setSidebarHovered(false)}
        >
          <div className="flex flex-col h-full">
            {/* Logo/Brand - Fixed height */}
            <div className="flex items-center px-4 py-6 border-b border-white/10 h-20">
              <div className="w-8 h-8 bg-gradient-to-br from-purple-500 to-blue-500 rounded-lg flex-shrink-0" />
              <span className={`ml-3 text-white font-semibold transition-opacity duration-300 ${
                sidebarHovered ? 'opacity-100 delay-100' : 'opacity-0'
              }`}>TinyGen</span>
            </div>

            {/* Navigation Items */}
            <nav className="py-4 space-y-1">
              {sidebarItems.map((item) => (
                <button
                  key={item.label}
                  onClick={item.onClick}
                  className={`w-full flex items-center px-4 py-2 transition-all duration-200 cursor-pointer ${
                    item.active 
                      ? 'bg-white/10 text-white' 
                      : 'text-white/60 hover:bg-white/5 hover:text-white'
                  }`}
                >
                  <div className="w-8 h-8 flex items-center justify-center flex-shrink-0">
                    <item.icon className="w-5 h-5" />
                  </div>
                  <span className={`ml-3 text-sm whitespace-nowrap overflow-hidden transition-all duration-300 ${
                    sidebarHovered ? 'opacity-100 w-auto' : 'opacity-0 w-0'
                  }`}>{item.label}</span>
                </button>
              ))}
            </nav>

            <Separator className="bg-white/10" />

            {/* User Section at Bottom - Fixed height */}
            <div className="mt-auto border-t border-white/10 h-20">
              <div className="flex items-center px-4 py-4">
                <div className="w-8 h-8 rounded-full bg-gradient-to-br from-purple-400 to-blue-400 flex-shrink-0 flex items-center justify-center">
                  <span className="text-white text-sm font-medium">
                    {user.user_metadata?.user_name?.[0]?.toUpperCase() || user.email?.[0]?.toUpperCase() || 'U'}
                  </span>
                </div>
                <div className={`ml-3 flex-1 transition-all duration-300 ${
                  sidebarHovered ? 'opacity-100 w-auto' : 'opacity-0 w-0'
                }`}>
                  <p className="text-white text-sm font-medium truncate">
                    {user.user_metadata?.user_name || user.email?.split('@')[0] || 'User'}
                  </p>
                  <button 
                    onClick={signOut}
                    className="text-white/60 text-xs hover:text-white transition-colors flex items-center gap-1"
                  >
                    <LogOut className="w-3 h-3" />
                    Sign out
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Main Content - Adjusted margin when signed in */}
      <div className={`relative z-10 min-h-screen flex items-center justify-center ${user ? 'ml-16' : ''}`}>
        {/* Not signed in */}
        {!user ? (
          <div className="text-center">
            <h1 className="text-5xl font-bold text-white mb-4">Welcome to TinyGen</h1>
            <p className="text-white/60 mb-8">Your AI-powered coding assistant</p>
            <Button
              onClick={signInWithGitHub}
              className="bg-white/10 hover:bg-white/20 text-white border border-white/20 backdrop-blur-sm px-6 py-3"
            >
              <FaGithub className="w-5 h-5 mr-2" />
              Sign in with GitHub
            </Button>
          </div>
        ) : (
          // Signed in - Show chat interface or recent tasks
          activePage === 'recent' ? (
            // Recent Tasks Page
            <div className="w-full max-w-4xl">
              <h2 className="text-2xl font-semibold text-white mb-6">Recent Tasks</h2>
              <div className="space-y-3">
                {recentChats.length > 0 ? (
                  recentChats.map((chat) => (
                    <button
                      key={chat.id}
                      onClick={() => selectChat(chat)}
                      className="w-full text-left p-4 bg-white/5 backdrop-blur-sm rounded-xl border border-white/10 hover:bg-white/10 hover:border-white/20 transition-all duration-200"
                    >
                      <h3 className="text-white font-medium mb-1">{chat.title}</h3>
                      {chat.github_repo_url && (
                        <div className="flex items-center gap-2 text-white/40 text-sm">
                          <FaGithub className="w-4 h-4" />
                          <span className="truncate">{chat.github_repo_url}</span>
                        </div>
                      )}
                      <p className="text-white/40 text-xs mt-2">
                        {new Date(chat.updated_at).toLocaleString()}
                      </p>
                    </button>
                  ))
                ) : (
                  <p className="text-white/40 text-center py-8">No recent tasks yet. Start a new conversation!</p>
                )}
              </div>
            </div>
          ) : (
            // Chat Interface
            <div className="w-full max-w-3xl flex flex-col" style={{ height: 'calc(100vh - 8rem)' }}>
              {/* Messages Area */}
              {(messages.length > 0 || currentChatId) ? (
                <div className="flex-1 overflow-y-auto mb-6 space-y-4 pb-4">
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

                  {/* GitHub URL input - Only show when no active chat */}
                  {!currentChatId && (
                    <div className="w-full mb-6 animate-fade-in">
                      <div className="relative group">
                        <FaGithub className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-white/40" />
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
                  )}
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
                      className="absolute right-2 top-1/2 -translate-y-1/2 p-3 bg-white/5 hover:bg-white/10 rounded-xl transition-all duration-200 group-focus-within:bg-white/10 disabled:opacity-50"
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
                        className="px-4 py-2 bg-white/5 backdrop-blur-sm rounded-xl border border-white/10 text-white/60 hover:bg-white/10 hover:text-white/80 hover:border-white/20 transition-all duration-200 text-sm"
                      >
                        {prompt}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )
        )}
      </div>
    </div>
  );
}