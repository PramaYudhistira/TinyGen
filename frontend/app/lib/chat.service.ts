import * as supabaseClient from '~/lib/supabase.client';

export function useChatService() {
  const supabase = supabaseClient.useSupabaseWithClerk();

  const createChat = async (title: string, githubRepoUrl?: string) => {
    const { data, error } = await supabase
      .from('chats')
      .insert({
        title,
        github_repo_url: githubRepoUrl || null,
      })
      .select()
      .single();

    if (error) throw error;
    return data as supabaseClient.Chat;
  };

  const getChats = async () => {
    const { data, error } = await supabase
      .from('chats')
      .select('*')
      .order('updated_at', { ascending: false });

    if (error) throw error;
    return data as supabaseClient.Chat[];
  };

  const getChat = async (chatId: string) => {
    const { data, error } = await supabase
      .from('chats')
      .select('*')
      .eq('id', chatId)
      .single();

    if (error) throw error;
    return data as supabaseClient.Chat;
  };

  const updateChatTitle = async (chatId: string, title: string) => {
    const { data, error } = await supabase
      .from('chats')
      .update({ title, updated_at: new Date().toISOString() })
      .eq('id', chatId)
      .select()
      .single();

    if (error) throw error;
    return data as supabaseClient.Chat;
  };

  const deleteChat = async (chatId: string) => {
    const { error } = await supabase
      .from('chats')
      .delete()
      .eq('id', chatId);

    if (error) throw error;
  };

  const createMessage = async (chatId: string, content: string, role: 'user' | 'assistant' | 'system' = 'user', metadata?: Record<string, any>) => {
    const { data, error } = await supabase
      .from('messages')
      .insert({
        chat_id: chatId,
        content,
        role,
        metadata: metadata || {},
      })
      .select()
      .single();

    if (error) throw error;

    // Update chat's updated_at timestamp
    await supabase
      .from('chats')
      .update({ updated_at: new Date().toISOString() })
      .eq('id', chatId);

    return data as supabaseClient.Message;
  };

  const getMessages = async (chatId: string) => {
    const { data, error } = await supabase
      .from('messages')
      .select('*')
      .eq('chat_id', chatId)
      .order('created_at', { ascending: true });

    if (error) throw error;
    return data as supabaseClient.Message[];
  };

  return {
    createChat,
    getChats,
    getChat,
    updateChatTitle,
    deleteChat,
    createMessage,
    getMessages,
  };
}