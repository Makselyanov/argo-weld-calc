import { supabase } from '@/lib/supabaseClient';
import type { CalculationFormData } from '@/types/calculation';
import type { PriceResult } from '@/utils/pricing';

export interface StoredCalculationSummary {
    id: string;
    description: string;
    totalMin: number;
    totalMax: number;
    status: string;
    createdAt: string;
}

export interface DetailedCalculation {
    id: string;
    description: string;
    typeOfWork: string | null;
    material: string | null;
    thickness: string | null;
    weldType: string | null;
    volume: string;
    position: string | null;
    conditions: string[];
    materialOwner: string | null;
    deadline: string | null;
    extraServices: string[];
    totalMin: number;
    totalMax: number;
    status: string;
    createdAt: string;
}

export async function saveCalculation(form: CalculationFormData, price: PriceResult): Promise<string> {
    try {
        const { data, error } = await supabase
            .from('calculations')
            .insert({
                description: form.description,
                photos: form.photos, // jsonb
                type_of_work: form.typeOfWork,
                material: form.material,
                thickness: form.thickness,
                weld_type: form.weldType,
                volume: form.volume,
                position: form.position,
                conditions: form.conditions,
                material_owner: form.materialOwner,
                deadline: form.deadline,
                extra_services: form.extraServices,
                base_min: price.baseMin,
                base_max: price.baseMax,
                total_min: price.totalMin,
                total_max: price.totalMax,
                status: 'ordered',
            })
            .select('id')
            .single();

        if (error) {
            throw error;
        }

        if (!data) {
            throw new Error('No data returned from insert');
        }

        // Отправляем уведомление в Telegram через Edge Function
        try {
            await supabase.functions.invoke('send-weld-notify', {
                body: {
                    id: data.id,
                    description: form.description,
                    typeOfWork: form.typeOfWork,
                    material: form.material,
                    deadline: form.deadline,
                    totalMin: price.totalMin,
                    totalMax: price.totalMax,
                    status: 'ordered'
                }
            });
        } catch (notifyError) {
            // Логируем ошибку, но не прерываем выполнение
            console.error('Не удалось отправить уведомление в Telegram:', notifyError);
        }

        return data.id;
    } catch (error) {
        console.error('Error saving calculation:', error);
        throw error;
    }
}

export async function getCalculations(): Promise<StoredCalculationSummary[]> {
    try {
        const { data, error } = await supabase
            .from('calculations')
            .select('id, description, total_min, total_max, status, created_at')
            .order('created_at', { ascending: false });

        if (error) {
            throw error;
        }

        return (data || []).map((item) => ({
            id: item.id,
            description: item.description,
            totalMin: item.total_min,
            totalMax: item.total_max,
            status: item.status,
            createdAt: item.created_at,
        }));
    } catch (error) {
        console.error('Error fetching calculations:', error);
        throw error;
    }
}

export async function getAllCalculations(): Promise<DetailedCalculation[]> {
    try {
        const { data, error } = await supabase
            .from('calculations')
            .select('*')
            .order('created_at', { ascending: false });

        if (error) {
            throw error;
        }

        return (data || []).map((item) => ({
            id: item.id,
            description: item.description,
            typeOfWork: item.type_of_work,
            material: item.material,
            thickness: item.thickness,
            weldType: item.weld_type,
            volume: item.volume || '',
            position: item.position,
            conditions: item.conditions || [],
            materialOwner: item.material_owner,
            deadline: item.deadline,
            extraServices: item.extra_services || [],
            totalMin: item.total_min,
            totalMax: item.total_max,
            status: item.status,
            createdAt: item.created_at,
        }));
    } catch (error) {
        console.error('Error fetching all calculations:', error);
        throw error;
    }
}

export async function updateCalculationStatus(
    id: string,
    status: 'ordered' | 'in_progress' | 'done' | 'cancelled'
): Promise<void> {
    try {
        const { error } = await supabase
            .from('calculations')
            .update({ status })
            .eq('id', id);

        if (error) {
            throw error;
        }
    } catch (error) {
        console.error('Error updating calculation status:', error);
        throw error;
    }
}
