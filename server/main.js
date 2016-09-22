import { Meteor } from 'meteor/meteor';
import fbgraph from 'fbgraph';
import { Relations, Friends, UserData, Notes, LastReciprocated } from '../both/collections.js'
import { appId, appSecret } from './social-config.js'

Meteor.startup(() => {
  // code to run on server at startup
});

function updateOnReciprocation(senderId, receiverId, type){
    let selector = {"senderId":senderId, "receiverId":receiverId, "type":type};
    Relations.update(selector, {$set: {"reciprocated":true}})
    let doc = {"senderId":senderId, "receiverId":receiverId, "type":type, "datetime":Date()}
    LastReciprocated.upsert(selector, doc)
}

function checkAndProcessReciprocity(id1, id2, type){
    if (reciprocates(id1, id2, type)) {
        email1 = getEmail(id1);
        email2 = getEmail(id2);
        name1 = getName(id1);
        name2 = getName(id2);
        emailForReciprocity(email1, email2, name1, name2, type);
        notifyForReciprocity(id1, name2, type)
        notifyForReciprocity(id2, name1, type)
        updateOnReciprocation(id1, id2, type);
        updateOnReciprocation(id2, id1, type);
        return true;
    }
    return false;
}

function reciprocates(senderId, receiverId, type) {
    var result = Relations.findOne({"senderId":receiverId, "receiverId":senderId, "type":type});
    var reciprocated = !(typeof result == 'undefined') && (result.published === true)
    return reciprocated
}
function getEmail(id) {
    var doc = UserData.findOne({"id":id});
    return doc.email
}
function getFirstName(id) {
    return getName(id).split(" ")[0]
}
function getName(id) {
    var doc = UserData.findOne({"id":id});
    return doc.name
}
function getId(meteorId) {
    var doc = UserData.findOne({"meteorId":meteorId});
    return doc.id
}
function emailForReciprocity(email1, email2, name1, name2, type){
    Email.send({
        cc: [email1, email2],
        from:"meddler@reciprocity.io",
        subject:"Reciprocation!",
        text:"Dear " + name1 + " and " + name2 +",\n\nGood news! You both want to " + type + ", You can use this thread to organize if you want.\n\nYours,\nreciprocity.io",
    });
}
function notifyForReciprocity(id1, name2, type) {
    notify(id1, "You and " + name2 + " both want to " + type + ".")
}
function notify(id, message) {
    let query = "/oauth/access_token?client_id="+appId+"&client_secret="+appSecret+"&grant_type=client_credentials";
    let result = Meteor.wrapAsync(fbgraph.get)(query);
    fbgraph.post(id + "/notifications?template="+message+"&access_token="+result.access_token, (err, resp) => console.log(err, resp))
}
//function permute(doc) {
//    newDoc = doc
//    newDoc.senderId = doc.receiverId
//    newDoc.receiverId = doc.senderId
//    return [doc, newDoc]
//}

Meteor.methods({
    registerUser : function() {
        if (!(Meteor.user() && Meteor.user().services)) {
            return false;
        }
        let user = Meteor.user().services.facebook
    	fbgraph.setAccessToken(user.accessToken);
    	let my_info = Meteor.wrapAsync(fbgraph.get)('me?fields=email,name,picture,link')
        let getFriends = function(s) {
            fbgraph.get(s, Meteor.bindEnvironment(function(err, res) {
                if (res.paging && res.paging.next) {
                    getFriends(res.paging.next)
                }

                for (var i = 0; i < res["data"].length; i++) {
                    let friend_info = res["data"][i]

                    let datum = {};
                    datum.picture = friend_info.picture;
                    datum.link = friend_info.link;
                    datum.name = friend_info.name;
                    datum.id = friend_info.id;

                    let friendUserData = UserData.findOne({"id":friend_info.id});
                    if (friendUserData) {
                        datum.registered_date = friendUserData.registered_date;
                    }

                    var selector = {};
                    selector["senderId"] = user.id;
                    selector["senderMeteorId"] = Meteor.userId();
                    selector["id"] = friend_info.id;
                    Object.assign(datum, selector)

                    Friends.upsert(selector, datum);

                    if (friendUserData) {
                        let friendMeteorId = friendUserData.meteorId;

                        let reciprocal_datum = {}
                        reciprocal_datum.picture = my_info .picture;
                        reciprocal_datum.link = my_info.link;
                        reciprocal_datum.name = my_info.name;
                        reciprocal_datum.id = my_info.id;

                        let reciprocal_selector = {}
                        reciprocal_selector["senderId"] = friend_info.id;
                        reciprocal_selector["senderMeteorId"] = friendMeteorId;
                        reciprocal_selector["id"] = my_info.id;
                        Object.assign(reciprocal_datum, reciprocal_selector)

                        Friends.upsert(reciprocal_selector, reciprocal_datum);
                    }

                }
            }));
        }
        getFriends('me/friends?limit=5000&fields=picture,name,link');
        let selector = {"id":user.id}
        let doc = {
            "id":user.id,
            "email":my_info.email,
            "name":my_info.name,
            "meteorId":Meteor.userId(),
            "picture":my_info.picture,
        }
        let affected = UserData.upsert(selector, doc);
        if (affected.insertedId) {
            let set_time = {$set: {"registered_date":Date.now()}};
            UserData.update({"id":user.id}, set_time);
            Friends.update({"id":user.id}, set_time);
        }
    	return true;
    },
    notify : function({receiverId, type}) {
        let senderId = Meteor.user().services.facebook.id;
        let selector = {"senderId":senderId, "receiverId":receiverId,
            "type":type, "reciprocated":true};
        let updated = Relations.update(selector, {$set: {"alerted":true}});
        return (updated > 0)
    },
    setNote : function({note}) {
        var id = Meteor.user().services.facebook.id;
        var meteorId = Meteor.userId()
        var selector = {"meteorId":meteorId};
        var datum = {"id":id, "meteorId":meteorId, "note":note};
        Notes.upsert(selector, datum)
    },
    getNote : function({id}){
        var doc = Notes.findOne({"id":id});
        return doc["note"]
    },
    getPicture : function() {
    	fbgraph.setAccessToken(Meteor.user().services.facebook.accessToken);
    	return Meteor.wrapAsync(fbgraph.get)('me?fields=picture').picture
    },
    getMe : function({s}) {
    	fbgraph.setAccessToken(Meteor.user().services.facebook.accessToken);
    	var result = Meteor.wrapAsync(fbgraph.get)('me' + s)
    	return result
    },
    addRelation : function({receiverId, type}) {
        let senderId = Meteor.user().services.facebook.id;
        let unremoveSelector = {"senderId":senderId, "receiverId":receiverId,
            "type":type, "reciprocated":false, "to_remove":true};
        let unremoved = Relations.update(unremoveSelector, {$set: {"to_remove":false}});
        if (unremoved == 0) {
            let selector = {"senderId":senderId, "receiverId":receiverId,
                "type":type, "reciprocated":false};
            let doc = {
                $set: {"senderId":senderId, "receiverId":receiverId,
                "type":type,
                "senderMeteorId":Meteor.userId(),
                "published":false, "to_remove":false, "reciprocated":false,
                "alerted":false}
            };
            Relations.upsert(selector, doc);
        }
    },
    publishRelations : function() {
        let senderId = Meteor.user().services.facebook.id;
    	fbgraph.setAccessToken(Meteor.user().services.facebook.accessToken);
        Relations.remove(
            {"senderId":senderId, "to_remove":true}
        );
        let updated_relations = Relations.find(
            {"senderId":senderId, "published":false}
        ).fetch();
        Relations.update(
            {"senderId":senderId, "published":false},
            {$set: {"published":true}},
            {multi:true}
        );
        return updated_relations.filter(function (doc){
            return checkAndProcessReciprocity(senderId, doc.receiverId, doc.type);
        })
    },
    removeRelation : function({receiverId, type}) {
        var senderId = Meteor.user().services.facebook.id;
        Relations.update(
            {"senderId":senderId, "receiverId":receiverId, "type":type, "reciprocated":false},
            {$set: {"to_remove":true}}
        )
    },
    getRelations : function() {
        var cursor = Relations.find({"senderId":Meteor.user().services.facebook.id});
        var result = [];
        cursor.forEach(function(item) {
            result.push({"receiverId":item.receiverId, "type":item.type});
        })
        return result;
    },
})
