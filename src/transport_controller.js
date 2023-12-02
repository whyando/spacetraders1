/*
TransportController assigns transport tasks to ships

TransportTask consists of:
- list of >=1 location action pairs 
- priority
- ship type filter

actions: refresh_market, refresh_shipyard, buy_goods, sell_goods, buy_ship, construction, contract_deliver, contract_negotiate

Algorithm:
- pick highest priority unassigned task
- for each ship, calculate 'completion time' of task
  t = ship_queue_finish_time + travel_duration(ship_queue_finish_loc, task_start_loc) + task_completion_duration
- assign task to ship with lowest completion time

- add/rm ship -> unassign all queued tasks -> reassign tasks
- add/rm task -> unassign all queued tasks where priority is strictly lower -> reassign tasks
- reassigning every task has worst case complexity: O(N * M)


synchronous interface: 
- ships added/removed, tasks added/removed/completed
- get_ship_current_task

how do the tasks get executed? - somebody else's job - individual ship executors
what happens to a task once it's completed?
can tasks fail or be interrupted?

*/

class TransportController {
    constructor() {
        this.ships = [];
        this.tasks = [];
    }
    
    register_ship(ship) {
        this.ships.push(ship);
    }
    unregister_ship(ship) {
        
    }

    add_task(task) {
        this.tasks.push(task);
    }
    remove_task(task) {
        
    }

    

}





