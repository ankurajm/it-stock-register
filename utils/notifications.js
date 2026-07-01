const { all, run, get } = require('../config/db');
const { sendEmail } = require('./mailer');

async function checkOverdueAllocations() {
    try {
        const overdue = await all(`
            SELECT a.*, e.name as emp_name, e.email, e.department, i.asset_tag, i.category, i.brand
            FROM allocations a
            JOIN employees e ON a.employee_id = e.id
            JOIN items i ON a.item_id = i.id
            WHERE a.status = 'active'
              AND a.expected_return_date IS NOT NULL
              AND a.expected_return_date < CURRENT_DATE
        `);

        for (const alloc of overdue) {
            const existing = await get(
                `SELECT id FROM notifications WHERE allocation_id = ? AND notification_type = 'overdue' AND is_read = 0`,
                [alloc.id]
            );
            if (!existing) {
                await run(
                    `INSERT INTO notifications (allocation_id, employee_id, notification_type, channel, subject, message) VALUES (?, ?, 'overdue', 'in_app', ?, ?)`,
                    [
                        alloc.id,
                        alloc.employee_id,
                        `Overdue: ${alloc.asset_tag} (${alloc.category})`,
                        `${alloc.emp_name} (${alloc.department}) has overdue item ${alloc.asset_tag} - ${alloc.brand}. Expected return: ${alloc.expected_return_date}`
                    ]
                );

                if (alloc.email) {
                    await sendEmail(
                        alloc.email,
                        `Overdue IT Asset Return: ${alloc.asset_tag}`,
                        `<p>Dear ${alloc.emp_name},</p>
                         <p>This is a reminder that the following IT asset is overdue for return:</p>
                         <ul>
                            <li><strong>Asset Tag:</strong> ${alloc.asset_tag}</li>
                            <li><strong>Category:</strong> ${alloc.category}</li>
                            <li><strong>Brand:</strong> ${alloc.brand || '-'}</li>
                            <li><strong>Expected Return:</strong> ${alloc.expected_return_date}</li>
                         </ul>
                         <p>Please return the item to the IT department immediately.</p>
                         <p>Regards,<br>IT Stock Register</p>`
                    );
                }
            }
        }
        return overdue.length;
    } catch (err) {
        console.error('Check overdue error:', err.message);
        return 0;
    }
}

async function checkUpcomingReturns(days = 7) {
    try {
        const upcoming = await all(`
            SELECT a.*, e.name as emp_name, e.email, e.department, i.asset_tag, i.category, i.brand
            FROM allocations a
            JOIN employees e ON a.employee_id = e.id
            JOIN items i ON a.item_id = i.id
            WHERE a.status = 'active'
              AND a.expected_return_date IS NOT NULL
              AND a.expected_return_date BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '1 day' * $1
        `, [days]);

        for (const alloc of upcoming) {
            const existing = await get(
                `SELECT id FROM notifications WHERE allocation_id = ? AND notification_type = 'return_reminder' AND is_read = 0`,
                [alloc.id]
            );
            if (!existing) {
                await run(
                    `INSERT INTO notifications (allocation_id, employee_id, notification_type, channel, subject, message) VALUES (?, ?, 'return_reminder', 'in_app', ?, ?)`,
                    [
                        alloc.id,
                        alloc.employee_id,
                        `Return Due: ${alloc.asset_tag} (${alloc.category})`,
                        `${alloc.emp_name} (${alloc.department}) - Item ${alloc.asset_tag} due on ${alloc.expected_return_date}`
                    ]
                );

                if (alloc.email) {
                    await sendEmail(
                        alloc.email,
                        `IT Asset Return Reminder: ${alloc.asset_tag}`,
                        `<p>Dear ${alloc.emp_name},</p>
                         <p>This is a friendly reminder that the following IT asset is due for return soon:</p>
                         <ul>
                            <li><strong>Asset Tag:</strong> ${alloc.asset_tag}</li>
                            <li><strong>Category:</strong> ${alloc.category}</li>
                            <li><strong>Brand:</strong> ${alloc.brand || '-'}</li>
                            <li><strong>Expected Return:</strong> ${alloc.expected_return_date}</li>
                         </ul>
                         <p>Please return the item to the IT department on or before the due date.</p>
                         <p>Regards,<br>IT Stock Register</p>`
                    );
                }
            }
        }
        return upcoming.length;
    } catch (err) {
        console.error('Check upcoming returns error:', err.message);
        return 0;
    }
}

async function getUnreadCount(employeeId) {
    try {
        const result = await get(
            `SELECT COUNT(*) as count FROM notifications WHERE employee_id = ? AND is_read = 0`,
            [employeeId]
        );
        return parseInt(result?.count || 0);
    } catch (err) {
        return 0;
    }
}

async function getNotifications(employeeId, limit = 20) {
    try {
        return await all(
            `SELECT * FROM notifications WHERE employee_id = ? ORDER BY created_at DESC LIMIT ?`,
            [employeeId, limit]
        );
    } catch (err) {
        return [];
    }
}

async function markAsRead(notificationId) {
    try {
        await run(`UPDATE notifications SET is_read = 1 WHERE id = ?`, [notificationId]);
    } catch (err) {
        console.error('Mark read error:', err.message);
    }
}

module.exports = { checkOverdueAllocations, checkUpcomingReturns, getUnreadCount, getNotifications, markAsRead };
