import { createClient } from '@supabase/supabase-js'

// Replace these with your REAL project details from the Supabase Dashboard
const supabaseUrl = 'https://spcdrinyafbdhjzgcuzy.supabase.co' 
const supabaseAnonKey = 'sb_publishable_GOqqpEdBqyRhu8sAB3648g_QDW0UBeu' 

export const supabase = createClient(supabaseUrl, supabaseAnonKey)