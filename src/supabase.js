import { createClient } from '@supabase/supabase-js'

const supabaseUrl = 'https://dvhpdjzxbamvvrlvsiti.supabase.co' 
const supabaseAnonKey = 'sb_publishable_AtV5ueB6tuhSm7chAxkGYg_zMeIKinm' 

export const supabase = createClient(supabaseUrl, supabaseAnonKey)
