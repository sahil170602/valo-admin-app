import { createClient } from '@supabase/supabase-js'

const supabaseUrl = 'https://spcdrinyafbdhjzgcuzy.supabase.co' 
const supabaseAnonKey = 'sb_publishable_GOqqpEdBqyRhu8sAB3648g_QDW0UBeu' 

export const supabase = createClient(supabaseUrl, supabaseAnonKey)