import React, { useState } from 'react';
import PageTitle from '../../components/shared/PageTitle';
import Card from '../../components/shared/Card';
import Button from '../../components/shared/Button';
import Notification from '../../components/shared/Notification';
import { migrateDailySummaries, migrateExpenseTransactions } from '../../api/dataEntryService';
import { FileUp } from 'lucide-react';

const DataMigration = () => {
    const [dailySummaryFile, setDailySummaryFile] = useState(null);
    const [expenseFile, setExpenseFile] = useState(null);
    const [loading, setLoading] = useState(false);
    const [notification, setNotification] = useState({ show: false, message: '', type: 'success' });

    const handleFileChange = (e, fileType) => {
        const file = e.target.files[0];
        if (fileType === 'dailySummary') {
            setDailySummaryFile(file);
        } else if (fileType === 'expense') {
            setExpenseFile(file);
        }
    };

    const processAndMigrateFile = async (file, migrationFunction) => {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = async (e) => {
                try {
                    const jsonData = JSON.parse(e.target.result);
                    await migrationFunction(jsonData);
                    resolve();
                } catch (err) {
                    reject(new Error(`Failed to process or migrate data: ${err.message}`));
                }
            };
            reader.onerror = (err) => reject(new Error('Failed to read file.'));
            reader.readAsText(file);
        });
    };

    const handleMigrate = async (e) => {
        e.preventDefault();
        setLoading(true);
        setNotification({ show: false, message: '', type: 'success' });

        try {
            if (dailySummaryFile) {
                await processAndMigrateFile(dailySummaryFile, migrateDailySummaries);
                setNotification({ show: true, message: 'Daily Summaries migrated successfully!', type: 'success' });
                setDailySummaryFile(null);
            }

            if (expenseFile) {
                await processAndMigrateFile(expenseFile, migrateExpenseTransactions);
                setNotification({ show: true, message: 'Expense Transactions migrated successfully!', type: 'success' });
                setExpenseFile(null);
            }

            if (!dailySummaryFile && !expenseFile) {
                setNotification({ show: true, message: 'Please select at least one file to migrate.', type: 'error' });
            }

        } catch (err) {
            console.error('Migration error:', err);
            setNotification({ show: true, message: err.message, type: 'error' });
        } finally {
            setLoading(false);
        }
    };

    return (
        <>
            <PageTitle title="Data Migration" subtitle="Upload historical data to the new database structure." />
            {notification.show && <Notification notification={notification} setNotification={setNotification} />}

            <Card className="mb-6">
                <h3 className="text-lg font-semibold text-gray-700 mb-4 flex items-center"><FileUp className="mr-2" /> Upload Daily Summaries</h3>
                <form onSubmit={handleMigrate} className="space-y-4">
                    <p className="text-sm text-gray-500">Upload a JSON file containing an array of Daily Summary objects.</p>
                    <input type="file" accept=".json" onChange={(e) => handleFileChange(e, 'dailySummary')} className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100" />
                    {dailySummaryFile && <p className="text-sm text-gray-600">Selected file: <span className="font-medium">{dailySummaryFile.name}</span></p>}
                </form>
            </Card>

            <Card className="mb-6">
                <h3 className="text-lg font-semibold text-gray-700 mb-4 flex items-center"><FileUp className="mr-2" /> Upload Expense Transactions</h3>
                <form onSubmit={handleMigrate} className="space-y-4">
                    <p className="text-sm text-gray-500">Upload a JSON file containing an array of Expense Transaction objects.</p>
                    <input type="file" accept=".json" onChange={(e) => handleFileChange(e, 'expense')} className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100" />
                    {expenseFile && <p className="text-sm text-gray-600">Selected file: <span className="font-medium">{expenseFile.name}</span></p>}
                </form>
            </Card>

            <Button onClick={handleMigrate} disabled={loading || (!dailySummaryFile && !expenseFile)} className="w-full">
                {loading ? 'Migrating...' : 'Start Migration'}
            </Button>
        </>
    );
};

export default DataMigration;