import { SimpleGrid, Paper, Group, Text, ThemeIcon } from '@mantine/core';
import { IconBook, IconUsers, IconBuildingCommunity } from '@tabler/icons-react';
import { motion } from 'framer-motion';

interface StatCardProps {
    title: string;
    value: string | number;
    icon: React.ReactNode;
    color: string;
}

function StatCard({ title, value, icon, color }: StatCardProps) {
    return (
        <motion.div
            whileHover={{ y: -5, transition: { duration: 0.2 } }}
            style={{ height: '100%' }}
        >
            <Paper p="md" radius="md" shadow="sm" style={{ height: '100%' }}>
                <Group justify="space-between" align="flex-start">
                    <div>
                        <Text size="xs" c="dimmed" tt="uppercase" fw={700}>
                            {title}
                        </Text>
                        <Text size="xl" fw={700} mt={4}>
                            {value}
                        </Text>
                    </div>
                    <ThemeIcon color={color} variant="light" size={48} radius="md">
                        {icon}
                    </ThemeIcon>
                </Group>
            </Paper>
        </motion.div>
    );
}

interface StatsGridProps {
    totalCourses?: number;
    facultyCount?: number;
    roomUtilization?: number;
}

export function StatsGrid({
    totalCourses = 12,
    facultyCount = 8,
    roomUtilization = 75
}: StatsGridProps) {
    const stats = [
        { title: 'Total Courses', value: totalCourses, icon: <IconBook size={24} />, color: 'indigo' },
        { title: 'Faculty Count', value: facultyCount, icon: <IconUsers size={24} />, color: 'teal' },
        { title: 'Room Utilization', value: `${roomUtilization}%`, icon: <IconBuildingCommunity size={24} />, color: 'orange' },
    ];

    return (
        <SimpleGrid cols={{ base: 1, sm: 3 }} spacing="md">
            {stats.map((stat, index) => (
                <motion.div
                    key={stat.title}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: index * 0.1 }}
                >
                    <StatCard {...stat} />
                </motion.div>
            ))}
        </SimpleGrid>
    );
}
